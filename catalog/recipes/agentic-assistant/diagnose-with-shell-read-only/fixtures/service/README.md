# Northstar status service

Clients and the operator handbook use `GET /health` for the health endpoint.
The service should return status 200 and body `ok` for that request.
