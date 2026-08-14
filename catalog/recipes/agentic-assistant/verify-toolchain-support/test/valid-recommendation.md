# Verdict

Relay export is not operational today: documentation advertises it [D1] and the
adapter is enabled [C1], but the code requires a token reference [S1] and the
runtime records neither a secret nor a successful attempt [R1].

## Evidence table

| Layer | Finding |
| --- | --- |
| Documentation | Capability is conditional [D1]. |
| Configuration | Enabled, token reference missing [C1]. |
| Source | Authentication is required [S1]. |
| Runtime | No executed proof exists [R1]. |

## Unknowns

Whether a valid token can be provisioned.

## Next action

Provision a disposable token, then execute and record one export canary.
