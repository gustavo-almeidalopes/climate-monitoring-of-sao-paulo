class ServiceError(Exception):
    """Erro base para camada de servico."""


class NotFoundError(ServiceError):
    pass


class ProviderUnavailableError(ServiceError):
    pass


class ValidationError(ServiceError):
    pass
