#!/usr/bin/env bash
#
# Start development server. Secrets must already be present in the environment.
#

LOG_LEVEL="${LOG_LEVEL:-DEBUG}" NODE_ENV="${NODE_ENV:-development}" npm run dev
