package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

var ctx = context.Background()
var SqsQueueUrl = ""
var sqsClient *sqs.Client

type Config struct {
	Port         int16
	SqsQueueName string
}

type IpMessage struct {
	Ip string `json:"ip"`
}

// SetupSqs
// Initialize SQS client
func SetupSqs(queue_name string) error {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Fatalf("unable to load SDK config, %v", err)
	}

	sqsClient = sqs.NewFromConfig(cfg)
	res, err := sqsClient.GetQueueUrl(ctx, &sqs.GetQueueUrlInput{
		QueueName: aws.String(queue_name),
	})
	if err != nil {
		log.Fatalf("unable to get queue URL, %v", err)
		return err
	}
	SqsQueueUrl = *res.QueueUrl
	return nil
}

func loadConfig() Config {
	viper.BindEnv("port")
	viper.BindEnv("sqsqueuename")

	config := Config{}
	config.Port = int16(viper.GetInt("port"))
	config.SqsQueueName = viper.GetString("SqsQueueName")

	return config
}

func DeleteMessage(receiptHandle string) {
	// Create an input to delete the message
	deleteMessageInput := &sqs.DeleteMessageInput{
		QueueUrl:      aws.String(SqsQueueUrl),
		ReceiptHandle: aws.String(receiptHandle),
	}

	// Call SQS to delete the message
	_, err := sqsClient.DeleteMessage(ctx, deleteMessageInput)
	if err != nil {
		log.Fatalf("failed to delete message, %v", err)
	}

	fmt.Println("Message deleted successfully")
}

func StartSqsReader() {
	// A signal handler or similar could be used to set this to false to break the loop.
	run := true

	for run {
		// Receive a message from the SQS queue
		receiveMessageInput := &sqs.ReceiveMessageInput{
			QueueUrl:            aws.String(SqsQueueUrl),
			MaxNumberOfMessages: 1,  // Number of messages to receive (up to 10)
			WaitTimeSeconds:     10, // Long polling (wait up to 10 seconds)
			MessageAttributeNames: []string{
				"All", // Retrieves all message attributes
			},
		}

		// Call the SQS ReceiveMessage API
		result, err := sqsClient.ReceiveMessage(ctx, receiveMessageInput)
		if err != nil {
			log.Fatalf("failed to receive messages, %v", err)
		}

		for _, message := range result.Messages {
			fmt.Printf("Message ID: %s\n", *message.MessageId)
			fmt.Printf("Message Body: %s\n", *message.Body)

			// Print message attributes if present
			if len(message.MessageAttributes) > 0 {
				for key, attr := range message.MessageAttributes {
					fmt.Printf("Attribute: %s, Value: %s\n", key, *attr.StringValue)
				}
			}

			// Optionally, you can delete the message after processing
			DeleteMessage(*message.ReceiptHandle)
		}
	}

}

func main() {
	config := loadConfig()

	err := SetupSqs(config.SqsQueueName)
	if err != nil {
		log.Fatalf("unable to setup SQS, %v", err)
		panic(err)
	}

	go StartSqsReader()
	router := gin.Default()
	router.GET("/health", func(ctx *gin.Context) { ctx.Status(http.StatusOK) })
	fmt.Print("loaded")
	router.Run("0.0.0.0:" + fmt.Sprint(config.Port))
}
