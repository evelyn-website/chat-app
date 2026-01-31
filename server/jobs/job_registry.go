package jobs

import (
	"os"
	"strings"
)

// JobConfig represents a job and its enabled status
type JobConfig struct {
	Job     Job
	Enabled bool
}

// IsEnabled checks if the job is enabled via config or environment variable
// Environment variable format: JOB_{JOB_NAME}=false
// Example: JOB_DELETE_EXPIRED_RESERVATIONS=false
func (c *JobConfig) IsEnabled() bool {
	if !c.Enabled {
		return false
	}

	// Check for environment variable override
	envKey := "JOB_" + strings.ToUpper(c.Job.Name())
	envValue := os.Getenv(envKey)
	if envValue == "false" || envValue == "0" {
		return false
	}

	return true
}

// GetJobConfigs returns all registered jobs with their configurations
// Initially returns an empty slice - jobs will be added here as they are implemented
func GetJobConfigs(baseJob BaseJob) []JobConfig {
	return []JobConfig{
		// Jobs will be added here as they are implemented
		// Example:
		// {
		//     Job:     &DeleteExpiredReservationsJob{BaseJob: baseJob},
		//     Enabled: true,
		// },
	}
}
