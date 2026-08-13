# Competition-day Ubuntu host

This is the laptop-hosted replacement for the competition-day EC2 API. It runs
the existing Node competition backend and the normal Arduino UNO USB bridge as
one operator command while Amplify, Cognito, the registration Lambda, and
DynamoDB continue normally.

Start here: [Competition-day laptop architecture](../docs/COMPETITION_DAY_LAPTOP.md).

```bash
./setup-ubuntu.sh
# edit .env and reconnect/login after any dialout group change
./check-readiness.sh
./run-ubuntu.sh
```

The staff console is `/competition-day` in a frontend built with
`VITE_EVENT_MODE=competition`.

