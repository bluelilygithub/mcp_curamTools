#!/usr/bin/env python3
"""
Spec Validator — deterministic hydraulic calculation engine.

Reads a JSON object from stdin, runs calculations, writes JSON to stdout.
Exit 0 on success, 1 on fatal error (error JSON written to stdout).

Input schema: see CALCULATION INPUT FORMAT below.
Output schema: see CALCULATION OUTPUT FORMAT below.

Called via execFileAsync — never via shell exec.
"""

import sys
import json
import math
import time
import platform

try:
    import fluids
    import numpy as np
    FLUIDS_VERSION = fluids.__version__
    NUMPY_VERSION = np.__version__
    PYTHON_VERSION = platform.python_version()
except ImportError as e:
    sys.stdout.write(json.dumps({"error": f"Missing dependency: {e}"}))
    sys.exit(1)

# ── Constants ──────────────────────────────────────────────────────────────────

WATER_KINEMATIC_VISCOSITY = 1.004e-6   # m²/s at 20 °C
GRAVITY = 9.81                          # m/s²
WATER_SPECIFIC_WEIGHT = 9810.0         # N/m³ = ρg

# AS/NZS 3500.1 velocity limits
MAX_VELOCITY_MS = 3.0    # m/s — cold water, WSAA/AS3500 typical limit
MIN_VELOCITY_MS = 0.5    # m/s — below this, stagnation risk

# Tolerance for stated-vs-calculated discrepancy before issuing WARNING/FAIL
PRESSURE_TOLERANCE_PCT = 10.0   # ±10 % is within reasonable engineering tolerance
VELOCITY_TOLERANCE_PCT = 10.0

# AS/NZS 3500.1 minimum fixture residual pressures (kPa)
AS3500_FIXTURE_MINIMUMS = {
    "default":    20.0,
    "shower":    100.0,
    "bath":       20.0,
    "wc":         20.0,
    "basin":      20.0,
    "kitchen":    20.0,
}


# ── Helper: safe round ─────────────────────────────────────────────────────────

def r(v, n=4):
    if v is None:
        return None
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return v


# ── Individual check functions ─────────────────────────────────────────────────

def check_velocity(check):
    """
    Verify a stated pipe velocity using the continuity equation V = Q / A.
    Also computes Reynolds number and classifies flow regime.
    """
    params = check.get("parameters", {})
    Q_ls  = float(params["flow_rate_ls"])
    D_mm  = float(params["internal_diameter_mm"])
    stated = float(check["stated_value"])
    cid    = check.get("check_id", "")
    seg    = check.get("segment_ref", "")

    Q_m3s = Q_ls / 1000.0
    D_m   = D_mm / 1000.0
    A_m2  = math.pi * (D_m / 2.0) ** 2
    V_ms  = Q_m3s / A_m2

    Re = fluids.Reynolds(V=V_ms, D=D_m, nu=WATER_KINEMATIC_VISCOSITY)
    if Re < 2000:
        regime = "laminar"
    elif Re < 4000:
        regime = "transitional"
    else:
        regime = "turbulent"

    discrepancy_abs = V_ms - stated
    discrepancy_pct = (discrepancy_abs / stated * 100.0) if stated != 0 else 0.0

    if V_ms > MAX_VELOCITY_MS:
        status = "FAIL"
        standard_ref = (
            f"AS/NZS 3500.1:2021 Cl 3.4 — calculated velocity {V_ms:.3f} m/s "
            f"exceeds maximum 3.0 m/s"
        )
    elif V_ms < MIN_VELOCITY_MS:
        status = "WARNING"
        standard_ref = (
            f"AS/NZS 3500.1:2021 Cl 3.4 — velocity {V_ms:.3f} m/s below 0.5 m/s "
            f"minimum; risk of stagnation and water quality degradation"
        )
    elif abs(discrepancy_pct) > VELOCITY_TOLERANCE_PCT:
        status = "WARNING"
        standard_ref = (
            f"Velocity {V_ms:.3f} m/s is within AS/NZS 3500.1 limits but stated "
            f"value {stated} m/s differs by {discrepancy_pct:.1f}% — indicates "
            f"calculation or transcription error in source document"
        )
    else:
        status = "PASS"
        standard_ref = (
            f"AS/NZS 3500.1:2021 Cl 3.4 — velocity {V_ms:.3f} m/s within "
            f"acceptable range [0.5, 3.0] m/s"
        )

    return {
        "check_id":              cid,
        "segment_ref":           seg,
        "check_type":            "velocity",
        "stated_value":          r(stated, 3),
        "calculated_value":      r(V_ms, 3),
        "unit":                  "m/s",
        "discrepancy_absolute":  r(discrepancy_abs, 3),
        "discrepancy_pct":       r(discrepancy_pct, 1),
        "status":                status,
        "standard_reference":    standard_ref,
        "tolerance_applied":     f"{VELOCITY_TOLERANCE_PCT}%",
        "formula_used":          "V = Q / A = Q / (π × (D/2)²)",
        "working": {
            "Q_ls":               r(Q_ls, 4),
            "Q_m3s":              r(Q_m3s, 7),
            "D_mm":               r(D_mm, 2),
            "D_m":                r(D_m, 5),
            "A_m2":               r(A_m2, 8),
            "V_calculated_ms":    r(V_ms, 4),
            "V_stated_ms":        r(stated, 3),
            "reynolds_number":    int(Re),
            "flow_regime":        regime,
            "nu_m2s":             WATER_KINEMATIC_VISCOSITY,
            "step_1_area":        f"A = π × ({D_m:.5f}/2)² = {A_m2:.8f} m²",
            "step_2_velocity":    f"V = {Q_m3s:.7f} / {A_m2:.8f} = {V_ms:.4f} m/s",
            "step_3_reynolds":    f"Re = {V_ms:.4f} × {D_m:.5f} / {WATER_KINEMATIC_VISCOSITY} = {int(Re)}",
        },
    }


def check_pressure_drop_hw(check):
    """
    Verify a stated pressure drop using the Hazen-Williams formula.

    hf = 10.67 × L_eq × Q^1.852 / (C^1.852 × D^4.87)   [m head]
    hf_kPa = hf × 9.81

    Where Q is m³/s and D is metres.
    """
    params  = check.get("parameters", {})
    Q_ls    = float(params["flow_rate_ls"])
    D_mm    = float(params["internal_diameter_mm"])
    L_m     = float(params["length_m"])
    L_eq_m  = float(params.get("equiv_length_m") or L_m)
    C       = float(params.get("hw_coefficient") or 120)
    stated  = float(check["stated_value"])     # kPa
    cid     = check.get("check_id", "")
    seg     = check.get("segment_ref", "")

    Q_m3s = Q_ls / 1000.0
    D_m   = D_mm / 1000.0

    # Hazen-Williams friction head loss
    Q_exp   = Q_m3s ** 1.852
    C_exp   = C ** 1.852
    D_exp   = D_m  ** 4.87
    hf_m    = 10.67 * L_eq_m * Q_exp / (C_exp * D_exp)
    hf_kpa  = hf_m * GRAVITY

    # Velocity for context
    A_m2 = math.pi * (D_m / 2.0) ** 2
    V_ms = Q_m3s / A_m2

    discrepancy_abs = hf_kpa - stated
    discrepancy_pct = (discrepancy_abs / stated * 100.0) if stated != 0 else 0.0

    if abs(discrepancy_pct) <= PRESSURE_TOLERANCE_PCT:
        status = "PASS"
        standard_ref = (
            f"Hazen-Williams pressure drop {hf_kpa:.2f} kPa within "
            f"±{PRESSURE_TOLERANCE_PCT}% of stated {stated} kPa"
        )
    elif discrepancy_abs > 0:
        status = "FAIL"
        standard_ref = (
            f"AS/NZS 3500.1:2021 — stated pressure drop {stated} kPa underestimates "
            f"actual loss by {discrepancy_pct:.1f}% ({discrepancy_abs:.2f} kPa). "
            f"This error reduces the residual pressure available at downstream fixtures."
        )
    else:
        status = "WARNING"
        standard_ref = (
            f"Calculated pressure drop {hf_kpa:.2f} kPa is lower than stated "
            f"{stated} kPa — overestimation is conservative but should be verified "
            f"to ensure system is not over-designed."
        )

    return {
        "check_id":              cid,
        "segment_ref":           seg,
        "check_type":            "pressure_drop_hw",
        "stated_value":          r(stated, 2),
        "calculated_value":      r(hf_kpa, 2),
        "unit":                  "kPa",
        "discrepancy_absolute":  r(discrepancy_abs, 2),
        "discrepancy_pct":       r(discrepancy_pct, 1),
        "status":                status,
        "standard_reference":    standard_ref,
        "tolerance_applied":     f"±{PRESSURE_TOLERANCE_PCT}%",
        "formula_used":          "hf = 10.67 × L_eq × Q^1.852 / (C^1.852 × D^4.87); kPa = hf_m × 9.81",
        "working": {
            "Q_ls":               r(Q_ls, 4),
            "Q_m3s":              r(Q_m3s, 7),
            "D_mm":               r(D_mm, 2),
            "D_m":                r(D_m, 5),
            "L_pipe_m":           r(L_m, 3),
            "L_equiv_m":          r(L_eq_m, 3),
            "C_hw":               r(C, 1),
            "Q_exp_1852":         r(Q_exp, 10),
            "C_exp_1852":         r(C_exp, 4),
            "D_exp_487":          r(D_exp, 12),
            "hf_m":               r(hf_m, 5),
            "hf_kpa":             r(hf_kpa, 3),
            "V_ms":               r(V_ms, 3),
            "step_1_numerator":   f"10.67 × {L_eq_m:.3f} × {Q_m3s:.7f}^1.852 = {10.67 * L_eq_m * Q_exp:.8f}",
            "step_2_denominator": f"{C:.1f}^1.852 × {D_m:.5f}^4.87 = {C_exp:.4f} × {D_exp:.12f} = {C_exp * D_exp:.10f}",
            "step_3_hf_m":        f"{10.67 * L_eq_m * Q_exp:.8f} / {C_exp * D_exp:.10f} = {hf_m:.5f} m",
            "step_4_hf_kpa":      f"{hf_m:.5f} × 9.81 = {hf_kpa:.3f} kPa",
        },
    }


def check_pressure_drop_dw(check):
    """
    Verify a stated pressure drop using the Darcy-Weisbach equation.

    hf = f × (L/D) × V²/(2g)

    Friction factor f from Colebrook-White via fluids.friction_factor().
    """
    params      = check.get("parameters", {})
    Q_ls        = float(params["flow_rate_ls"])
    D_mm        = float(params["internal_diameter_mm"])
    L_m         = float(params["length_m"])
    L_eq_m      = float(params.get("equiv_length_m") or L_m)
    roughness_mm = float(params.get("roughness_mm") or 0.045)
    stated      = float(check["stated_value"])   # kPa
    cid         = check.get("check_id", "")
    seg         = check.get("segment_ref", "")

    Q_m3s  = Q_ls / 1000.0
    D_m    = D_mm / 1000.0
    eps_m  = roughness_mm / 1000.0
    A_m2   = math.pi * (D_m / 2.0) ** 2
    V_ms   = Q_m3s / A_m2

    Re  = fluids.Reynolds(V=V_ms, D=D_m, nu=WATER_KINEMATIC_VISCOSITY)
    eD  = eps_m / D_m
    f   = fluids.friction_factor(Re=Re, eD=eD)

    hf_m   = f * (L_eq_m / D_m) * (V_ms ** 2) / (2.0 * GRAVITY)
    hf_kpa = hf_m * GRAVITY

    discrepancy_abs = hf_kpa - stated
    discrepancy_pct = (discrepancy_abs / stated * 100.0) if stated != 0 else 0.0

    if abs(discrepancy_pct) <= PRESSURE_TOLERANCE_PCT:
        status = "PASS"
        standard_ref = f"Darcy-Weisbach pressure drop within ±{PRESSURE_TOLERANCE_PCT}% tolerance"
    elif discrepancy_abs > 0:
        status = "FAIL"
        standard_ref = (
            f"Stated pressure drop underestimates actual loss by "
            f"{discrepancy_pct:.1f}% ({discrepancy_abs:.2f} kPa)"
        )
    else:
        status = "WARNING"
        standard_ref = "Calculated pressure drop lower than stated (conservative)"

    return {
        "check_id":              cid,
        "segment_ref":           seg,
        "check_type":            "pressure_drop_dw",
        "stated_value":          r(stated, 2),
        "calculated_value":      r(hf_kpa, 2),
        "unit":                  "kPa",
        "discrepancy_absolute":  r(discrepancy_abs, 2),
        "discrepancy_pct":       r(discrepancy_pct, 1),
        "status":                status,
        "standard_reference":    standard_ref,
        "tolerance_applied":     f"±{PRESSURE_TOLERANCE_PCT}%",
        "formula_used":          "hf = f × (L/D) × V²/(2g); Colebrook-White friction factor via fluids.friction_factor()",
        "working": {
            "Q_m3s":              r(Q_m3s, 7),
            "D_m":                r(D_m, 5),
            "L_equiv_m":          r(L_eq_m, 3),
            "roughness_mm":       r(roughness_mm, 4),
            "V_ms":               r(V_ms, 4),
            "reynolds_number":    int(Re),
            "relative_roughness": r(eD, 7),
            "darcy_friction_f":   r(f, 6),
            "hf_m":               r(hf_m, 5),
            "hf_kpa":             r(hf_kpa, 3),
            "step_1_velocity":    f"V = {Q_m3s:.7f} / {A_m2:.8f} = {V_ms:.4f} m/s",
            "step_2_reynolds":    f"Re = {V_ms:.4f} × {D_m:.5f} / {WATER_KINEMATIC_VISCOSITY} = {int(Re)}",
            "step_3_friction":    f"f (Colebrook-White, Re={int(Re)}, ε/D={eD:.7f}) = {f:.6f}",
            "step_4_hf":          f"hf = {f:.6f} × ({L_eq_m:.3f}/{D_m:.5f}) × {V_ms:.4f}² / (2×9.81) = {hf_m:.5f} m",
        },
    }


def check_pressure_budget(pressure_budget, segment_results):
    """
    Verify the stated system pressure budget.

    available_pressure_kpa - sum(path drops) + static_head_correction_kpa
    must be >= minimum_fixture_pressure_kpa
    """
    if not pressure_budget:
        return None

    avail     = float(pressure_budget.get("available_pressure_kpa") or 0)
    static    = float(pressure_budget.get("static_head_correction_kpa") or 0)
    stated_r  = pressure_budget.get("stated_residual_kpa")
    min_fix   = float(pressure_budget.get("minimum_fixture_pressure_kpa") or AS3500_FIXTURE_MINIMUMS["default"])
    path_refs = pressure_budget.get("critical_path_segment_refs") or []

    # Gather pressure drop for each segment on the critical path
    path_drops = []
    for ref in path_refs:
        for r_entry in segment_results:
            if r_entry.get("segment_ref") == ref and r_entry.get("check_type") in (
                "pressure_drop_hw", "pressure_drop_dw"
            ):
                path_drops.append({
                    "segment_ref":     ref,
                    "check_id":        r_entry.get("check_id"),
                    "pressure_drop_kpa": r_entry["calculated_value"],
                })
                break

    total_drops = sum(d["pressure_drop_kpa"] for d in path_drops)
    residual    = avail - total_drops + static
    margin      = residual - min_fix

    if residual < min_fix:
        status = "FAIL"
        standard_ref = (
            f"AS/NZS 3500.1:2021 — calculated residual pressure {residual:.1f} kPa "
            f"is below minimum fixture requirement {min_fix:.1f} kPa at critical point"
        )
    elif margin < 5.0:
        status = "WARNING"
        standard_ref = (
            f"Residual pressure margin {margin:.1f} kPa above AS/NZS 3500.1 "
            f"minimum — less than 5 kPa margin; no capacity for future demand growth"
        )
    else:
        status = "PASS"
        standard_ref = (
            f"AS/NZS 3500.1:2021 — residual pressure {residual:.1f} kPa satisfies "
            f"minimum fixture requirement {min_fix:.1f} kPa with {margin:.1f} kPa margin"
        )

    stated_discrepancy = None
    if stated_r is not None:
        stated_r_f = float(stated_r)
        stated_discrepancy = {
            "stated_residual_kpa":     r(stated_r_f, 2),
            "calculated_residual_kpa": r(residual, 2),
            "difference_kpa":          r(residual - stated_r_f, 2),
        }

    return {
        "check_type":               "pressure_budget",
        "status":                   status,
        "standard_reference":       standard_ref,
        "available_pressure_kpa":   r(avail, 2),
        "static_head_correction_kpa": r(static, 2),
        "total_path_drop_kpa":      r(total_drops, 2),
        "calculated_residual_kpa":  r(residual, 2),
        "minimum_fixture_kpa":      r(min_fix, 2),
        "margin_kpa":               r(margin, 2),
        "critical_path_drops":      path_drops,
        "stated_discrepancy":       stated_discrepancy,
        "formula_used":             "residual = available − Σ(path drops) + static_head_correction",
        "working": {
            "step_1_available":   f"Available supply pressure: {avail:.2f} kPa",
            "step_2_drops":       f"Σ critical path drops ({', '.join(path_refs)}): {total_drops:.2f} kPa",
            "step_3_static":      f"Static head correction: {static:+.2f} kPa",
            "step_4_residual":    f"Residual = {avail:.2f} - {total_drops:.2f} + ({static:.2f}) = {residual:.2f} kPa",
            "step_5_check":       f"Residual {residual:.2f} kPa vs minimum {min_fix:.2f} kPa → margin {margin:.2f} kPa",
        },
    }


# ── Dispatch table ─────────────────────────────────────────────────────────────

CHECK_HANDLERS = {
    "velocity":          check_velocity,
    "pressure_drop_hw":  check_pressure_drop_hw,
    "pressure_drop_dw":  check_pressure_drop_dw,
}


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    start_ms = time.time() * 1000

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    checks   = payload.get("checks", [])
    pbudget  = payload.get("pressure_budget")

    results = []
    errors  = []

    for check in checks:
        ctype = check.get("check_type")
        handler = CHECK_HANDLERS.get(ctype)
        if not handler:
            errors.append(f"Unknown check_type '{ctype}' for check_id '{check.get('check_id', '?')}'")
            continue
        try:
            results.append(handler(check))
        except (KeyError, ValueError, ZeroDivisionError) as e:
            errors.append(f"check_id '{check.get('check_id', '?')}': {e}")
            results.append({
                "check_id":    check.get("check_id", ""),
                "segment_ref": check.get("segment_ref", ""),
                "check_type":  ctype,
                "status":      "ERROR",
                "error":       str(e),
            })

    pressure_budget_result = check_pressure_budget(pbudget, results)

    elapsed_ms = (time.time() * 1000) - start_ms

    output = {
        "library_versions": {
            "fluids":  FLUIDS_VERSION,
            "numpy":   NUMPY_VERSION,
            "python":  PYTHON_VERSION,
        },
        "execution_time_ms": round(elapsed_ms, 1),
        "total_checks":      len(results),
        "pass_count":        sum(1 for r in results if r.get("status") == "PASS"),
        "warning_count":     sum(1 for r in results if r.get("status") == "WARNING"),
        "fail_count":        sum(1 for r in results if r.get("status") == "FAIL"),
        "error_count":       len(errors),
        "results":           results,
        "pressure_budget_result": pressure_budget_result,
        "errors":            errors if errors else None,
    }

    sys.stdout.write(json.dumps(output, indent=None))
    sys.exit(0)


if __name__ == "__main__":
    main()
