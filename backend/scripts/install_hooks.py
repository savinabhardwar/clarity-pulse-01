"""Install the repository's existing pre-commit secret scan."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
subprocess.run(["git", "-C", str(root), "config", "core.hooksPath", ".githooks"], check=True)
print("Installed .githooks pre-commit secret scan")
