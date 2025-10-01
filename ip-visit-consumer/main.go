package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/segmentio/kafka-go"
	"github.com/spf13/viper"
)

var (
	kafkaReader     *kafka.Reader
	consumerRunning bool
	mu              sync.RWMutex
	ctx             = context.Background()
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

// StartKafkaReader starts the Kafka consumer in a goroutine
func StartKafkaReader(config Config) {
	kafkaReader = kafka.NewReader(kafka.ReaderConfig{
		Brokers:  []string{config.KafkaAddress},
		Topic:    config.KafkaTopic,
		GroupID:  config.KafkaConsumerGroup,
		MinBytes: 10e3, // 10KB
		MaxBytes: 10e6, // 10MB
	})

	// Set consumer as running
	mu.Lock()
	consumerRunning = true
	mu.Unlock()

	log.Println("Starting Kafka consumer...")

	go func() {
		defer func() {
			mu.Lock()
			consumerRunning = false
			mu.Unlock()
			if kafkaReader != nil {
				kafkaReader.Close()
			}
		}()

		for {
			mu.RLock()
			running := consumerRunning
			mu.RUnlock()

			if !running {
				break
			}

			message, err := kafkaReader.FetchMessage(ctx)
			if err != nil {
				log.Printf("Consumer error: %v", err)
				time.Sleep(time.Second)
				continue
			}

			log.Printf("Received message: %s with headers: %v", string(message.Value), message.Headers)

			// Commit the message
			if err := kafkaReader.CommitMessages(ctx, message); err != nil {
				log.Printf("Failed to commit message: %v", err)
			}
		}
	}()
}

// HealthHandler handles the health check endpoint
func HealthHandler(c *gin.Context) {
	mu.RLock()
	running := consumerRunning
	mu.RUnlock()

	if !running {
		c.JSON(http.StatusInternalServerError, gin.H{
			"status":  "error",
			"message": "Consumer is not running",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}

func main() {
	config := LoadConfig()

	// Start Kafka reader in a separate goroutine
	StartKafkaReader(config)

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Shutting down...")

		// Stop the consumer
		mu.Lock()
		consumerRunning = false
		mu.Unlock()

		// Give some time for graceful shutdown
		time.Sleep(2 * time.Second)
		os.Exit(0)
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
