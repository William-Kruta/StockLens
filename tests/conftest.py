# tests/conftest.py
import sys
from pathlib import Path

# Ensure the project root (parent of tests/) is on sys.path so that
# `import secrs` works regardless of how pytest is invoked.
sys.path.insert(0, str(Path(__file__).parent.parent))
