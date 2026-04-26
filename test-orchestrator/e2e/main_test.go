package e2e

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	missing := missingE2EEnv()
	if len(missing) > 0 && os.Getenv("SMARTSCRAPER_TEST_ORCHESTRATOR") != "1" {
		fmt.Printf("skipping e2e package: missing %s. Run through `just test` or set TEST_BASE_URL, DATA_DIR, and API_TOKEN.\n", strings.Join(missing, ", "))
		os.Exit(0)
	}

	os.Exit(m.Run())
}

func missingE2EEnv() []string {
	required := []string{"TEST_BASE_URL", "DATA_DIR", "API_TOKEN"}
	missing := make([]string, 0, len(required))

	for _, name := range required {
		if os.Getenv(name) == "" {
			missing = append(missing, name)
		}
	}

	return missing
}
