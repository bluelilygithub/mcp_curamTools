#!/usr/bin/env python3
"""
Standalone test for calculator.py — 452 George Street hydraulic spec.

Three known errors from the document:
  CW-04  velocity      Q=1.04 L/s  DN20 ID=18.0mm  stated 2.51 m/s   actual 4.09 m/s  → FAIL
  CW-06  velocity      Q=0.52 L/s  DN25 ID=23.0mm  stated 0.87 m/s   actual 1.25 m/s  → WARNING
  CW-03  pressure drop Q=2.08 L/s  DN50 ID=47.0mm  stated 12.4 kPa   actual ~19.8 kPa → FAIL

Run from the specValidator directory:
    python3 test_calculator.py

No server dependencies — calls calculator.py via subprocess.
"""

import json
import subprocess
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CALCULATOR = os.path.join(SCRIPT_DIR, "calculator.py")

# ── Test payload ───────────────────────────────────────────────────────────────
# CW-03 pressure drop: Hazen-Williams with C=100 (AS/NZS 3500.1 recommended
# value for copper tube), total equivalent length 30.2m (pipe 8.2m + fittings
# equivalent 22.0m). Stated in document used C=120 (too high for copper tube
# sizing per AS/NZS 3500.1 Table 3.3) and omitted the fittings allowance.
# With correct inputs: hf = 10.67 × 30.2 × 0.00208^1.852 / (100^1.852 × 0.047^4.87)
#                       = 2.019 m × 9.81 = 19.8 kPa.

PAYLOAD = {
    "checks": [
        {
            "check_id":    "sv_cw04_velocity",
            "check_type":  "velocity",
            "segment_ref": "CW-04",
            "description": "Cold water branch to WC cistern — DN20 CPVC",
            "source_page": 3,
            "source_context": "CW-04  DN20  Q=1.04 L/s  V=2.51 m/s  (table row)",
            "parameters": {
                "flow_rate_ls":         1.04,
                "internal_diameter_mm": 18.0,
            },
            "stated_value": 2.51,
            "unit":         "m/s",
        },
        {
            "check_id":    "sv_cw06_velocity",
            "check_type":  "velocity",
            "segment_ref": "CW-06",
            "description": "Cold water branch to hand basin — DN25 CPVC",
            "source_page": 3,
            "source_context": "CW-06  DN25  Q=0.52 L/s  V=0.87 m/s  (table row)",
            "parameters": {
                "flow_rate_ls":         0.52,
                "internal_diameter_mm": 23.0,
            },
            "stated_value": 0.87,
            "unit":         "m/s",
        },
        {
            "check_id":    "sv_cw03_pressure",
            "check_type":  "pressure_drop_hw",
            "segment_ref": "CW-03",
            "description": "Cold water main riser to Level 3 — DN50 copper",
            "source_page": 4,
            "source_context": "CW-03  DN50  Q=2.08 L/s  L=8.2m  ΔP=12.4 kPa  (pressure schedule)",
            "parameters": {
                "flow_rate_ls":         2.08,
                "internal_diameter_mm": 47.0,
                "length_m":             8.2,
                "equiv_length_m":       30.2,
                "hw_coefficient":       100,
            },
            "stated_value": 12.4,
            "unit":         "kPa",
        },
        {
            # Reynolds number sanity check on the CW-04 pipe to confirm turbulent flow
            "check_id":    "sv_cw04_dw_xcheck",
            "check_type":  "pressure_drop_dw",
            "segment_ref": "CW-04",
            "description": "Darcy-Weisbach cross-check on CW-04 pressure drop",
            "source_page": 3,
            "source_context": "CW-04  DN20 ID=18.0mm  L=4.5m  roughness copper 0.0015mm",
            "parameters": {
                "flow_rate_ls":         1.04,
                "internal_diameter_mm": 18.0,
                "length_m":             4.5,
                "roughness_mm":         0.0015,
            },
            "stated_value": 8.2,
            "unit":         "kPa",
        },
    ],
    "pressure_budget": {
        "available_pressure_kpa":      350.0,
        "static_head_correction_kpa":  -49.1,
        "stated_residual_kpa":         280.0,
        "minimum_fixture_pressure_kpa": 20.0,
        "critical_path_segment_refs":  ["CW-03"],
        "source_page": 5,
    },
}


# ── Run calculator ─────────────────────────────────────────────────────────────

def run():
    proc = subprocess.run(
        [sys.executable, CALCULATOR],
        input=json.dumps(PAYLOAD),
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        print(f"CALCULATOR EXIT {proc.returncode}")
        if proc.stderr:
            print("STDERR:", proc.stderr)
        sys.exit(1)

    if proc.stderr:
        print("[STDERR]", proc.stderr.strip())

    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        print("RAW OUTPUT:", proc.stdout[:500])
        sys.exit(1)

    return result


# ── Assertions ─────────────────────────────────────────────────────────────────

def assert_check(results_by_id, check_id, expected_status, expected_calc_approx, tolerance=0.05):
    r = results_by_id.get(check_id)
    if r is None:
        print(f"  MISSING  {check_id}")
        return False

    calc = r.get("calculated_value")
    status = r.get("status")
    ok_status = status == expected_status
    ok_value  = abs(calc - expected_calc_approx) / expected_calc_approx <= tolerance

    icon = "OK" if (ok_status and ok_value) else "FAIL"
    print(
        f"  {icon:4}  {check_id:25}  "
        f"status={status:7}  expected={expected_status:7}  "
        f"calc={calc:.3f}  expected~{expected_calc_approx:.3f}  "
        f"unit={r.get('unit', '')}"
    )
    if not ok_status:
        print(f"         STATUS MISMATCH — got {status}, expected {expected_status}")
    if not ok_value:
        pct_err = abs(calc - expected_calc_approx) / expected_calc_approx * 100
        print(f"         VALUE MISMATCH — {pct_err:.1f}% off expected {expected_calc_approx:.3f}")

    return ok_status and ok_value


def main():
    print("=" * 70)
    print("Spec Validator — calculator.py test (452 George Street)")
    print("=" * 70)

    result = run()

    libs = result.get("library_versions", {})
    print(f"\nLibraries: fluids={libs.get('fluids')}  numpy={libs.get('numpy')}  python={libs.get('python')}")
    print(f"Execution: {result.get('execution_time_ms')} ms")
    print(
        f"Results: {result.get('total_checks')} checks — "
        f"{result.get('pass_count')} PASS / "
        f"{result.get('warning_count')} WARNING / "
        f"{result.get('fail_count')} FAIL / "
        f"{result.get('error_count')} ERROR"
    )

    if result.get("errors"):
        print("\nERRORS:", result["errors"])

    by_id = {r["check_id"]: r for r in result.get("results", [])}

    print("\n── Velocity checks ──────────────────────────────────────────────")
    # CW-04: V = Q/A = 0.00104 / (π × 0.009²) = 0.00104 / 2.5447e-4 = 4.087 m/s → FAIL (>3.0)
    ok1 = assert_check(by_id, "sv_cw04_velocity", "FAIL",    4.087, tolerance=0.01)
    # CW-06: V = Q/A = 0.00052 / (π × 0.0115²) = 0.00052 / 4.1548e-4 = 1.251 m/s → WARNING (discrepancy >10%)
    ok2 = assert_check(by_id, "sv_cw06_velocity", "WARNING", 1.252, tolerance=0.01)

    print("\n── Pressure drop checks ─────────────────────────────────────────")
    # CW-03: HW C=100, L_eq=30.2m → hf = 2.019m × 9.81 = 19.8 kPa → FAIL (stated 12.4, under by 59.7%)
    ok3 = assert_check(by_id, "sv_cw03_pressure",  "FAIL",    19.8,  tolerance=0.02)
    # CW-04 DW cross-check: should differ from stated 8.2 kPa (Darcy-Weisbach for copper, smooth pipe)
    ok4 = assert_check(by_id, "sv_cw04_dw_xcheck", None,      None)
    if "sv_cw04_dw_xcheck" in by_id:
        dw = by_id["sv_cw04_dw_xcheck"]
        print(f"         DW calc={dw.get('calculated_value'):.3f} kPa  status={dw.get('status')}")

    print("\n── Pressure budget ──────────────────────────────────────────────")
    pb = result.get("pressure_budget_result")
    if pb:
        print(
            f"  {"OK" if pb.get("status") in ("PASS","WARNING") else "FAIL":4}  "
            f"status={pb.get('status')}  "
            f"residual={pb.get('calculated_residual_kpa'):.1f} kPa  "
            f"margin={pb.get('margin_kpa'):.1f} kPa"
        )
    else:
        print("  MISSING  pressure_budget_result")

    print("\n── Full working for CW-04 velocity ──────────────────────────────")
    if "sv_cw04_velocity" in by_id:
        w = by_id["sv_cw04_velocity"].get("working", {})
        for k, v in w.items():
            print(f"  {k}: {v}")

    print("\n── Full working for CW-03 pressure drop ─────────────────────────")
    if "sv_cw03_pressure" in by_id:
        w = by_id["sv_cw03_pressure"].get("working", {})
        for k, v in w.items():
            print(f"  {k}: {v}")

    all_ok = ok1 and ok2 and ok3
    print("\n" + "=" * 70)
    if all_ok:
        print("ALL ASSERTIONS PASSED — calculation layer correct")
    else:
        print("ONE OR MORE ASSERTIONS FAILED — review output above")
    print("=" * 70)

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
