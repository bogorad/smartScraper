package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"gopkg.in/yaml.v3"
)

// Secrets holds SmartScraper configuration secrets.
type Secrets struct {
	APIToken         string `yaml:"API_TOKEN"`
	OpenRouterAPIKey string `yaml:"OPENROUTER_API_KEY"`
	TwoCaptchaAPIKey string `yaml:"TWOCAPTCHA_API_KEY"`
	ProxyServer      string `yaml:"PROXY_SERVER"`
}

// LoadSecrets loads secrets from environment variables or SOPS-encrypted secrets.yaml.
// Environment variables take precedence (for CI). Falls back to SOPS decryption (for local dev).
func LoadSecrets(verbose bool) (*Secrets, error) {
	// Check if required secrets are in environment variables
	if apiToken := os.Getenv("API_TOKEN"); apiToken != "" {
		if verbose {
			fmt.Println("Loading secrets from environment variables")
		}
		return &Secrets{
			APIToken:         apiToken,
			OpenRouterAPIKey: os.Getenv("OPENROUTER_API_KEY"),
			TwoCaptchaAPIKey: os.Getenv("TWOCAPTCHA_API_KEY"),
			ProxyServer:      os.Getenv("PROXY_SERVER"),
		}, nil
	}

	// Fall back to SOPS decryption
	if verbose {
		fmt.Println("Decrypting secrets.yaml via SOPS")
	}

	cmd := exec.Command("sops", "-d", "secrets.yaml")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("sops decrypt failed: %w\nstderr: %s", err, stderr.String())
	}

	var secrets Secrets
	if err := yaml.Unmarshal(stdout.Bytes(), &secrets); err != nil {
		return nil, fmt.Errorf("failed to parse secrets.yaml: %w", err)
	}

	if verbose {
		fmt.Println("Secrets loaded successfully")
	}

	return &secrets, nil
}

// Env returns secrets as environment variable strings suitable for exec.Cmd.Env.
// Only non-empty values are included.
func (s *Secrets) Env() []string {
	var env []string

	if s.APIToken != "" {
		env = append(env, "API_TOKEN="+s.APIToken)
	}
	if s.OpenRouterAPIKey != "" {
		env = append(env, "OPENROUTER_API_KEY="+s.OpenRouterAPIKey)
	}
	if s.TwoCaptchaAPIKey != "" {
		env = append(env, "TWOCAPTCHA_API_KEY="+s.TwoCaptchaAPIKey)
	}
	if s.ProxyServer != "" {
		env = append(env, "PROXY_SERVER="+s.ProxyServer)
	}

	return env
}

// String returns a redacted representation of the secrets for logging.
func (s *Secrets) String() string {
	var parts []string

	if s.APIToken != "" {
		parts = append(parts, fmt.Sprintf("API_TOKEN=%s", redact(s.APIToken)))
	}
	if s.OpenRouterAPIKey != "" {
		parts = append(parts, fmt.Sprintf("OPENROUTER_API_KEY=%s", redact(s.OpenRouterAPIKey)))
	}
	if s.TwoCaptchaAPIKey != "" {
		parts = append(parts, fmt.Sprintf("TWOCAPTCHA_API_KEY=%s", redact(s.TwoCaptchaAPIKey)))
	}
	if s.ProxyServer != "" {
		parts = append(parts, fmt.Sprintf("PROXY_SERVER=%s", redact(s.ProxyServer)))
	}

	return strings.Join(parts, ", ")
}

// redact returns a redacted version of a secret value for safe logging.
func redact(value string) string {
	if len(value) <= 8 {
		return "****"
	}
	return value[:4] + "****" + value[len(value)-4:]
}
