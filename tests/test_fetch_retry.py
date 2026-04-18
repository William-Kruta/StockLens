import pytest
import requests
from unittest.mock import patch, Mock
from secrs.utils.fetch import _get_with_retry


def _mock_response(status_code: int, retry_after: str | None = None) -> Mock:
    r = Mock()
    r.status_code = status_code
    r.ok = status_code < 400
    r.headers = {"Retry-After": retry_after} if retry_after else {}
    if not r.ok:
        r.raise_for_status.side_effect = requests.exceptions.HTTPError(str(status_code))
    else:
        r.raise_for_status.return_value = None
    return r


def test_returns_immediately_on_200():
    with patch("secrs.utils.fetch.requests.get", return_value=_mock_response(200)):
        with patch("secrs.utils.fetch.time.sleep") as mock_sleep:
            result = _get_with_retry("http://example.com", {})
    assert result.status_code == 200
    mock_sleep.assert_not_called()


def test_retries_on_429_and_succeeds():
    side_effects = [_mock_response(429), _mock_response(429), _mock_response(200)]
    with patch("secrs.utils.fetch.requests.get", side_effect=side_effects):
        with patch("secrs.utils.fetch.time.sleep"):
            result = _get_with_retry("http://example.com", {}, max_retries=3)
    assert result.status_code == 200


def test_retries_on_5xx_and_succeeds():
    side_effects = [_mock_response(503), _mock_response(200)]
    with patch("secrs.utils.fetch.requests.get", side_effect=side_effects):
        with patch("secrs.utils.fetch.time.sleep"):
            result = _get_with_retry("http://example.com", {}, max_retries=3)
    assert result.status_code == 200


def test_raises_after_max_retries_exhausted():
    with patch("secrs.utils.fetch.requests.get", return_value=_mock_response(429)):
        with patch("secrs.utils.fetch.time.sleep"):
            with pytest.raises(requests.exceptions.HTTPError):
                _get_with_retry("http://example.com", {}, max_retries=3)


def test_does_not_retry_on_404():
    side_effects = [_mock_response(404), _mock_response(200)]
    with patch("secrs.utils.fetch.requests.get", side_effect=side_effects) as mock_get:
        with patch("secrs.utils.fetch.time.sleep"):
            with pytest.raises(requests.exceptions.HTTPError):
                _get_with_retry("http://example.com", {}, max_retries=3)
    assert mock_get.call_count == 1  # only one attempt, no retry


def test_respects_retry_after_header():
    side_effects = [_mock_response(429, retry_after="5"), _mock_response(200)]
    with patch("secrs.utils.fetch.requests.get", side_effect=side_effects):
        with patch("secrs.utils.fetch.time.sleep") as mock_sleep:
            _get_with_retry("http://example.com", {}, max_retries=3)
    mock_sleep.assert_called_once_with(5.0)
