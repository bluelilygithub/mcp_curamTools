# App template (copy source)

Copy the **starter** app when creating a new product plugin:

```bash
cp -r server/apps/starter server/apps/my-app
```

Then follow `server/apps/starter/README.md`.

The `starter` app is the maintained minimal reference. This `_template` folder exists only as a discoverable entry point — it is **not** loaded at boot (folder names starting with `_` are rejected by `loadPlugins`).
