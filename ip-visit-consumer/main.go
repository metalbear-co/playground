package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/segmentio/kafka-go"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

var ctx = context.Background()
var KafkaWriter *kafka.Writer

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
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  []string{address},
		GroupID:  group,
		Topic:    topic,
		MaxBytes: 10e6, // 10MB
	})

	for {
		m, err := r.ReadMessage(context.Background())
		if err != nil {
			break
		}
		fmt.Printf("message at topic/partition/offset %v/%v/%v: %s = %s\n", m.Topic, m.Partition, m.Offset, string(m.Key), string(m.Value))
	}

	if err := r.Close(); err != nil {
		log.Fatal("failed to close reader:", err)
	}
}

func main() {
	config := loadConfig()

	go StartKafkaReader(config.KafkaAddress, config.KafkaTopic, config.KafkaConsumerGroup)

	router := gin.Default()
	router.GET("/health", func(ctx *gin.Context) { ctx.Status(http.StatusOK) })
	fmt.Print("loaded")
	router.Run("0.0.0.0:" + fmt.Sprint(config.Port))
}
