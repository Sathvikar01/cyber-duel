import os, sys
os.chdir(r"C:\Users\arsat\OneDrive\Desktop\hf2")
sys.path.insert(0, r"C:\Users\arsat\OneDrive\Desktop\hf2")
os.environ["SKIP_MODEL_LOAD"] = "1"

import uvicorn
import app as app_mod

if __name__ == "__main__":
    uvicorn.run(app_mod.app, host="0.0.0.0", port=5173, log_level="info")
