package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/segmentio/kafka-go"
	"github.com/spf13/viper"
)

// Config struct for application configuration
type Config struct {
	Port               int
	KafkaAddress       string
	KafkaTopic         string
	KafkaConsumerGroup string
}

// LoadConfig loads configuration from environment variables
func LoadConfig() Config {
	viper.BindEnv("port")
	viper.BindEnv("kafkaaddress")
	viper.BindEnv("kafkatopic")
	viper.BindEnv("kafkaconsumergroup")

	config := Config{
		Port:               viper.GetInt("port"),
		KafkaAddress:       viper.GetString("kafkaaddress"),
		KafkaTopic:         viper.GetString("kafkatopic"),
		KafkaConsumerGroup: viper.GetString("kafkaconsumergroup"),
	}

	// Set defaults
	if config.Port == 0 {
		config.Port = 5000
	}
	if config.KafkaAddress == "" {
		config.KafkaAddress = "localhost:9092"
	}
	if config.KafkaTopic == "" {
		config.KafkaTopic = "default-topic"
	}
	if config.KafkaConsumerGroup == "" {
		config.KafkaConsumerGroup = "default-group"
	}

	return config
}

func RunKafkaReader(config Config, ctx context.Context) {
	checkTopicCtx, cancel := context.WithTimeout(ctx, time.Second*30)
	conn, err := kafka.DialContext(checkTopicCtx, "tcp", config.KafkaAddress)
	cancel()
	if err != nil {
		log.Printf("Failed to connect to the Kafka broker at %v: %v", config.KafkaAddress, err)
		os.Exit(-1)
	}

	for {
		partitions, err := conn.ReadPartitions(config.KafkaTopic)
		if err != nil {
			log.Printf("Failed to read partitions of topic %v: %v", config.KafkaTopic, err)
			time.Sleep(time.Second * 3)
		} else {
			log.Printf("Fetched partitions of topic %v: %v", config.KafkaTopic, len(partitions))
			break
		}
	}

	log.Printf(
		"Starting Kafka reader with topic=(%v), group=(%v), broker=(%v)",
		config.KafkaTopic,
		config.KafkaConsumerGroup,
		config.KafkaAddress,
	)
	kafkaReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:               []string{config.KafkaAddress},
		Topic:                 config.KafkaTopic,
		GroupID:               config.KafkaConsumerGroup,
		Logger:                kafka.LoggerFunc(log.Printf),
		ErrorLogger:           kafka.LoggerFunc(log.Printf),
		WatchPartitionChanges: true,
	})

	defer func() {
		kafkaReader.Close()
		os.Exit(0)
	}()

	for {
		message, err := kafkaReader.ReadMessage(ctx)
		if err != nil {
			log.Printf("Consumer error: %v", err)
			break
		}
		log.Printf("Received message: %s with headers: %v", string(message.Value), message.Headers)
	}
}

// HealthHandler handles the health check endpoint
func HealthHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}

func main() {
	config := LoadConfig()

	// Start Kafka reader in a separate goroutine
	ctx, cancel := context.WithCancel(context.Background())
	go RunKafkaReader(config, ctx)

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Shutting down...")
		cancel()
	}()

	// Setup HTTP server
	router := gin.Default()
	router.GET("/health", HealthHandler)

	log.Println("Loaded")
	log.Printf("Starting server on port %d", config.Port)

	if err := router.Run(fmt.Sprintf("0.0.0.0:%d", config.Port)); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
