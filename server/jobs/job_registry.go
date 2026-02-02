package jobs

import (
	"chat-app-server/notifications"
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

// JobDependencies holds optional dependencies for jobs that need them
type JobDependencies struct {
	NotificationService *notifications.NotificationService
}

// GetJobConfigs returns all registered jobs with their configurations
func GetJobConfigs(baseJob BaseJob, deps *JobDependencies) []JobConfig {
	configs := []JobConfig{
		{
			Job:     &CleanupExpiredGroupsJob{BaseJob: baseJob},
			Enabled: true,
		},
		{
			Job:     &CleanupStaleReservationsJob{BaseJob: baseJob},
			Enabled: true,
		},
		{
			Job:     &CleanupStaleDeviceKeysJob{BaseJob: baseJob},
			Enabled: true,
		},
	}

	// Add notification-related jobs if notification service is available
	if deps != nil && deps.NotificationService != nil {
		configs = append(configs, JobConfig{
			Job:     NewProcessPushReceiptsJob(baseJob, deps.NotificationService),
			Enabled: true,
		})
	}

	return configs
}
