package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

var ctx = context.Background()
var RedisClient *redis.Client
var KafkaWriter *kafka.Writer
var RedisKey = "ip-visit-counter-"
var ResponseString = ""
var IpInfoAddress = ""

const RedisKeyTtl = 120 * time.Second

// SetupRedis
// Initialize the Redis instance
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

// SetupKafka
// Initialize the Kafka Writer
func SetupKafka(address, topic string) {
	KafkaWriter = &kafka.Writer{
		Addr:     kafka.TCP(address),
		Topic:    topic,
		Balancer: &kafka.LeastBytes{},
	}
}

// Config
// Struct that holds local service port, remote redis host and port
type Config struct {
	Port         int16
	RedisAddress string
	ResponseFile string
	KafkaAddress string
	KafkaTopic   string
}

type IpMessage struct {
	Ip string `json:"ip"`
}

type IpInfo struct {
	Ip   string `json:"ip"`
	Info string `json:"name"`
}

func loadConfig() Config {
	viper.BindEnv("port")
	viper.BindEnv("redisaddress")
	viper.BindEnv("responsefile")
	viper.BindEnv("kafkaaddress")
	viper.BindEnv("kafkatopic")
	viper.BindEnv("ipinfoaddress")

	config := Config{}
	config.Port = int16(viper.GetInt("port"))
	config.RedisAddress = viper.GetString("redisaddress")
	config.ResponseFile = viper.GetString("responsefile")
	config.KafkaAddress = viper.GetString("kafkaaddress")
	config.KafkaTopic = viper.GetString("kafkatopic")
	IpInfoAddress = viper.GetString("ipinfoaddress")

	return config
}

func getCount(c *gin.Context) {
	ip := c.ClientIP()
	key := RedisKey + ip
	// header propagation
	c.Set("PG-Tenant", c.GetHeader("x-pg-tenant"))

	count, err := RedisClient.Incr(c, key).Result()
	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	RedisClient.Expire(c, key, RedisKeyTtl)
	message, _ := json.Marshal(IpMessage{Ip: ip})

	err = KafkaWriter.WriteMessages(c, kafka.Message{Value: []byte(message)})
	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	ip_req_url, err := url.Parse(IpInfoAddress)

	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}
	ip_req_url = ip_req_url.JoinPath("ip", ip)
	req, err := http.NewRequestWithContext(c, "GET", ip_req_url.String(), nil)

	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	tenant, exists := c.Get("x-pg-tenant")
	if exists {
		if tenantStr, ok := tenant.(string); ok {
			req.Header.Add("x-pg-tenant", tenantStr)
		}
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}
	defer res.Body.Close()

	ipInfo := &IpInfo{}

	err = json.NewDecoder(res.Body).Decode(&ipInfo)
	if err != nil {
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(200, gin.H{"count": count, "text": ResponseString, "info": ipInfo})
}

func main() {
	config := loadConfig()

	fileContent, err := os.ReadFile(config.ResponseFile)
	if err != nil {
		log.Fatal(err)
	}

	ResponseString = string(fileContent)

	err = SetupRedis(config.RedisAddress)

	if err != nil {
		panic(err)
	}

	SetupKafka(config.KafkaAddress, config.KafkaTopic)

	router := gin.Default()
	router.GET("/health", func(ctx *gin.Context) { ctx.Status(http.StatusOK) })
	router.GET("/count", getCount)
	fmt.Print("loaded")
	router.Run("0.0.0.0:" + fmt.Sprint(config.Port))
}
