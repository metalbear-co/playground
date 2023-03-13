package main

import (
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/spf13/viper"
)

var ctx = context.Background()
var RedisClient *redis.Client
var RedisKey = "ip-visit-counter-"
var ResponseString = ""

const RedisKeyTtl = 120 * time.Second

// Setup Initialize the Redis instance
func SetupRedis(address string) error {
	RedisClient = redis.NewClient(&redis.Options{
		Addr:     address,
		Password: "", // no password set
		DB:       0,  // use default DB
	})
	err := RedisClient.Ping(ctx).Err()
	if err != nil {
		return err
	}

	return nil
}

// Struct that holds local service port, remote redis host and port
type Config struct {
	Port         int16
	RedisAddress string
	ResponseFile string
}

func loadConfig() Config {
	viper.BindEnv("port")
	viper.BindEnv("redisaddress")
	viper.BindEnv("responsefile")

	config := Config{}
	config.Port = int16(viper.GetInt("port"))
	config.RedisAddress = viper.GetString("redisaddress")
	config.ResponseFile = viper.GetString("responsefile")

	return config
}

func getCount(c *gin.Context) {
	ip := c.ClientIP()
	key := RedisKey + ip

	_, err := RedisClient.Incr(ctx, key).Result()
	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	RedisClient.Expire(ctx, key, RedisKeyTtl)

	count, err := RedisClient.Get(ctx, key).Int64()
	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(200, gin.H{"count": count})
}

func main() {
	config := loadConfig()

	fileContent, err := ioutil.ReadFile(config.ResponseFile)
	if err != nil {
		log.Fatal(err)
	}

	ResponseString = string(fileContent)

	err = SetupRedis(config.RedisAddress)

	if err != nil {
		panic(err)
	}

	router := gin.Default()
	router.GET("/count", getCount)

	router.Run("0.0.0.0:" + fmt.Sprint(config.Port))
}
