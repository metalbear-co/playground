package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

var ctx = context.Background()

// Config
// Struct that holds local service port, remote redis host and port
type Config struct {
	Port               int16
	KafkaAddress       string
	KafkaTopic         string
	KafkaConsumerGroup string
}

type IpInfo struct {
	Ip   string `json:"ip"`
	Info string `json:"name"`
}

// albums slice to seed record album data.
var ipInfos = []IpInfo{
	{Ip: "84.229.14.82", Info: "Aviram, Loves coffee!"},
}

func loadConfig() Config {
	viper.BindEnv("port")

	config := Config{}
	config.Port = int16(viper.GetInt("port"))
	return config
}

// Get information based on IP address
func getIpInfo(c *gin.Context) {
	ip := c.Param("ip")

	for _, info := range ipInfos {
		if info.Ip == ip {
			c.IndentedJSON(http.StatusOK, info)
			return
		}
	}
	info := IpInfo{Ip: ip, Info: "Unknown"}
	c.IndentedJSON(http.StatusOK, info)
}

func main() {
	config := loadConfig()

	router := gin.Default()
	router.GET("/health", func(ctx *gin.Context) { ctx.Status(http.StatusOK) })
	router.GET("/ip/:ip", getIpInfo)
	fmt.Print("loaded")
	router.Run("0.0.0.0:" + fmt.Sprint(config.Port))
}
