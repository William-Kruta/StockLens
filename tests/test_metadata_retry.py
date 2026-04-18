from unittest.mock import MagicMock, patch
import pytest


def test_fetch_json_uses_retry():
    """Test that _fetch_json calls _get_with_retry instead of requests.get."""
    mock_response = MagicMock()
    mock_response.json.return_value = {"data": 42}

    with patch("secrs.periphery.metadata._get_with_retry", return_value=mock_response) as mock_retry:
        from secrs.periphery.metadata import _fetch_json, HEADERS
        result = _fetch_json("https://example.com/fake.json")

    mock_retry.assert_called_once_with("https://example.com/fake.json", HEADERS)
    assert result == {"data": 42}
