"""One error shape for every failure: {"detail": "human-readable message", "code": "machine_code"}."""


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str):
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail


def bad_input(detail, code="invalid_input"):
    return ApiError(422, code, detail)


def not_found(detail, code="not_found"):
    return ApiError(404, code, detail)


def conflict(detail, code="conflict"):
    return ApiError(409, code, detail)


def unauthorized(detail="Please sign in again.", code="not_authenticated"):
    return ApiError(401, code, detail)
