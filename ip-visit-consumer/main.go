package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
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

type IpMessage struct {
	Ip string `json:"ip"`
}

func loadConfig() Config {
	viper.BindEnv("port")
	viper.BindEnv("kafkaaddress")
	viper.BindEnv("kafkatopic")
	viper.BindEnv("kafkaconsumergroup")

	config := Config{}
	config.Port = int16(viper.GetInt("port"))
	config.KafkaAddress = viper.GetString("kafkaaddress")
	config.KafkaTopic = viper.GetString("kafkatopic")
	config.KafkaConsumerGroup = viper.GetString("kafkaconsumergroup")

	return config
}

func StartKafkaReader(address, topic, group string) {

	c, err := kafka.NewConsumer(&kafka.ConfigMap{
		"bootstrap.servers": address,
		"group.id":          group,
		"auto.offset.reset": "earliest",
		"debug":             "all",
	})

	if err != nil {
		panic(err)
	}

	c.SubscribeTopics([]string{topic}, nil)

	// A signal handler or similar could be used to set this to false to break the loop.
	run := true

	for run {
		msg, err := c.ReadMessage(time.Second)
		if err == nil {
			if msg != nil {
				fmt.Printf("Message on %s: %s\n", msg.TopicPartition, string(msg.Value))
			}
		} else if !err.(kafka.Error).IsTimeout() {
			// The client will automatically try to recover from all errors.
			// Timeout is not considered an error because it is raised by
			// ReadMessage in absence of messages.
			fmt.Printf("Consumer error: %v (%v)\n", err, msg)
		}
	}

	c.Close()

}

func main() {
	config := loadConfig()

	go StartKafkaReader(config.KafkaAddress, config.KafkaTopic, config.KafkaConsumerGroup)
	router := gin.Default()
	router.GET("/health", func(ctx *gin.Context) { ctx.Status(http.StatusOK) })
	fmt.Print("loaded")
	router.Run("0.0.0.0:" + fmt.Sprint(config.Port))
}
