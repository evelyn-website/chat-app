package rediskeys

const (
	ClientServerPrefix  = "client:"
	ServerClientsPrefix = "server:"
	UserGroupsPrefix    = "user:"
	GroupMembersPrefix  = "group:"
	GroupInfoPrefix     = "groupinfo:"

	PubSubGroupMessagesChannel = "group_messages"
	PubSubGroupEventsChannel   = "group_events"
)
