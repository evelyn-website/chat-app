package router

import (
	"chat-app-server/auth"
	"chat-app-server/images"
	"chat-app-server/notifications"
	"chat-app-server/server"
	"chat-app-server/ws"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

var r *gin.Engine

func InitRouter(authHandler *auth.AuthHandler, wsHandler *ws.Handler, api *server.API, imageHandler *images.ImageHandler, notificationHandler *notifications.NotificationHandler) {
	r = gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:8081", "http://192.168.1.12:8081", "http://192.168.1.32:8081", "http://192.168.1.42:8081", "http://192.168.1.8:8081", "http://192.168.1.18:8081", "http://192.168.1.80:8081", "http://192.168.1.2:8081"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE"},
		AllowHeaders:     []string{"Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		AllowOriginFunc: func(origin string) bool {
			return origin == "http://localhost:8081"
		},
		MaxAge: 12 * time.Hour,
	}))

	// general API
	apiRoutes := r.Group("/api/")
	apiRoutes.Use(auth.JWTAuthMiddleware())

	apiRoutes.GET("/users/whoami", api.WhoAmI)
	apiRoutes.GET("/users/device-keys", api.GetRelevantDeviceKeys)

	apiRoutes.POST("/groups/reserve/:groupID", api.ReserveGroup)

	// Notification routes
	apiRoutes.POST("/notifications/register-token", notificationHandler.RegisterPushToken)
	apiRoutes.DELETE("/notifications/token", notificationHandler.ClearPushToken)

	// auth routes group
	authRoutes := r.Group("/auth/")
	authRoutes.POST("/signup", authHandler.Signup)
	authRoutes.POST("/login", authHandler.Login)

	// WS routes
	wsRoutes := r.Group("/ws/")
	wsRoutes.Use(auth.JWTAuthMiddleware())

	wsRoutes.POST("/create-group", wsHandler.CreateGroup)
	wsRoutes.PUT("/update-group/:groupID", wsHandler.UpdateGroup)
	wsRoutes.POST("/invite-users-to-group", wsHandler.InviteUsersToGroup)
	wsRoutes.POST("/remove-user-from-group", wsHandler.RemoveUserFromGroup)
	wsRoutes.GET("/get-groups", wsHandler.GetGroups)
	wsRoutes.GET("/get-users-in-group/:groupID", wsHandler.GetUsersInGroup)
	wsRoutes.POST("/leave-group/:groupID", wsHandler.LeaveGroup)
	wsRoutes.GET("/relevant-users", wsHandler.GetRelevantUsers)
	wsRoutes.GET("/relevant-messages", wsHandler.GetRelevantMessages)

	// authenticated after upgrade
	r.GET("/ws/establish-connection", wsHandler.EstablishConnection)

	// Image routes
	imageRoutes := r.Group("/images")
	imageRoutes.Use(auth.JWTAuthMiddleware())
	imageRoutes.POST("/presign-upload", imageHandler.PresignUpload)
	imageRoutes.POST("/presign-download", imageHandler.PresignDownload)
}

func Start(addr string) error {
	return r.Run(addr)
}
