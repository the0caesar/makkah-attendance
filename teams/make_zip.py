import zipfile, os
os.chdir("C:/Users/Essam Omar/Topics/Work/teams-attendance-app/teams")
out = "protection-portal-1.0.11.zip"
if os.path.exists(out):
    os.remove(out)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in ["manifest.json", "color.png", "outline.png"]:
        z.write(f)
print("created:", out, os.path.getsize(out), "bytes")
with zipfile.ZipFile(out) as z:
    print("contents:", z.namelist())
# verify the manifest contentUrl in the zip
import io
with zipfile.ZipFile(out) as z:
    m = z.read("manifest.json").decode()
    import re
    for key in ["contentUrl", "version", "makkah-attendance-api.makkah-attendance-api.workers.dev"]:
        print(key, "->", key in m)
