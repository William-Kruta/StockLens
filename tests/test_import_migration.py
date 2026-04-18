import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_income_statement_imports_from_statement_loader():
    """income_statement must import batch_get_statements from statement_loader."""
    import ast
    src = Path("secrs/modules/income_statement.py").read_text()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if "statement_loader" in (node.module or ""):
                return  # found the correct import
    raise AssertionError("income_statement.py still imports from statements, not statement_loader")


def test_balance_sheet_imports_from_statement_loader():
    import ast
    src = Path("secrs/modules/balance_sheet.py").read_text()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if "statement_loader" in (node.module or ""):
                return
    raise AssertionError("balance_sheet.py still imports from statements, not statement_loader")


def test_cash_flow_imports_from_statement_loader():
    import ast
    src = Path("secrs/modules/cash_flow.py").read_text()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if "statement_loader" in (node.module or ""):
                return
    raise AssertionError("cash_flow.py still imports from statements, not statement_loader")


def test_statements_py_deleted():
    """statements.py must not exist after migration."""
    assert not Path("secrs/periphery/statements.py").exists(), \
        "statements.py still exists — it should have been deleted"
