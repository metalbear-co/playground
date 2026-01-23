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

	"github.com/gin-contrib/cors"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
	"github.com/gin-gonic/gin"
	pb "github.com/metalbear-co/playground/protogen"
	"github.com/spf13/viper"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

var ctx = context.Background()
var RedisClient *redis.Client
var KafkaWriter *kafka.Writer
var RedisKey = "ip-visit-counter-"
var ResponseString = ""
var IpInfoAddress = ""
var IpInfoGrpcAddress = ""
var SqsQueueUrl = ""
var sqsClient *sqs.Client

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

// Config
// Struct that holds local service port, remote redis host and port
type Config struct {
	Port         int16
	RedisAddress string
	ResponseFile string
	KafkaAddress string
	KafkaTopic   string
	SqsQueueName string
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
	viper.BindEnv("sqsqueuename")
	viper.BindEnv("ipinfogrpcaddress")

	config := Config{}
	config.Port = int16(viper.GetInt("port"))
	config.RedisAddress = viper.GetString("redisaddress")
	config.ResponseFile = viper.GetString("responsefile")
	config.KafkaAddress = viper.GetString("kafkaaddress")
	config.KafkaTopic = viper.GetString("kafkatopic")
	IpInfoAddress = viper.GetString("ipinfoaddress")
	IpInfoGrpcAddress = viper.GetString("ipinfogrpcaddress")
	config.SqsQueueName = viper.GetString("sqsqueuename")

	return config
}

func SendSqsMessage(c *gin.Context, message []byte) {
	var messageAttributes map[string]types.MessageAttributeValue

	tenant, exists := c.Get("x-pg-tenant")
	if exists {
		if tenantStr, ok := tenant.(string); ok {
			messageAttributes = map[string]types.MessageAttributeValue{
				"x-pg-tenant": {
					DataType:    aws.String("String"),
					StringValue: aws.String(tenantStr),
				},
			}
		}
	}

	sendMessageInput := &sqs.SendMessageInput{
		QueueUrl:          aws.String(SqsQueueUrl),
		MessageBody:       aws.String(string(message)),
		MessageAttributes: messageAttributes,
	}

	result, err := sqsClient.SendMessage(c, sendMessageInput)
	if err != nil {
		log.Fatalf("failed to send message, %v", err)
	}
	// Print the message ID of the sent message
	fmt.Printf("Message sent, ID: %s\n", *result.MessageId)
}

func getIpInfoGrpc(ip string, c *gin.Context) (*IpInfo, error) {
	md := metadata.New(map[string]string{})
	tenant, exists := c.Get("x-pg-tenant")

	if exists {
		md.Append("x-pg-tenant", tenant.(string))
	}

	ctx := metadata.NewOutgoingContext(c, md)
	conn, err := grpc.NewClient(IpInfoGrpcAddress, grpc.WithInsecure())
	if err != nil {
		return nil, err
	}
	client := pb.NewIpInfoServiceClient(conn)

	res, err := client.GetIpInfo(ctx, &pb.IpRequest{Ip: ip})
	if err != nil {
		return nil, err

	}
	return &IpInfo{
		Ip:   res.Ip,
		Info: res.Info,
	}, nil

}

func getCount(c *gin.Context) {
	ip := c.ClientIP()
	key := RedisKey + ip
	// header propagation
	tenant := c.GetHeader("x-pg-tenant")
	if tenant != "" {
		c.Set("x-pg-tenant", tenant)
	}

	count, err := RedisClient.Incr(c, key).Result()
	if err != nil {
		log.Printf("ERROR: Redis Incr failed: %v", err)
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	RedisClient.Expire(c, key, RedisKeyTtl)
	message, _ := json.Marshal(IpMessage{Ip: ip})

	if sqsClient != nil {
		SendSqsMessage(c, message)
	}

	headers := []kafka.Header{}
	tenantInterface, exists := c.Get("x-pg-tenant")
	if exists {
		if tenantStr, ok := tenantInterface.(string); ok {
			headers = append(headers, kafka.Header{Key: "x-pg-tenant", Value: []byte(tenantStr)})
		}
	}

	err = KafkaWriter.WriteMessages(c, kafka.Message{
		Value:   []byte(message),
		Headers: headers,
	})

	if err != nil {
		log.Printf("ERROR: Kafka WriteMessages failed: %v", err)
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	ipInfo2, err := getIpInfoGrpc(ip, c)
	if err != nil {
		log.Printf("ERROR: getIpInfoGrpc failed: %v", err)
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

	req.Header.Set("x-pg-tenant", tenant)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("ERROR: HTTP request to ip-info failed: %v", err)
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		log.Printf("ERROR: ip-info returned status %d", res.StatusCode)
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	ipInfo := &IpInfo{}

	err = json.NewDecoder(res.Body).Decode(&ipInfo)
	if err != nil {
		log.Printf("ERROR: Failed to decode ip-info response: %v", err)
		c.JSON(500, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(200, gin.H{
		"count":       count,
		"info":        ipInfo,
		"info2":       ipInfo2,
		"text":        ResponseString + "hi",
		"demo_marker": "mirrord-ci-demo",
	})
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
	if config.SqsQueueName != "" {
		err = SetupSqs(config.SqsQueueName)

		if err != nil {
			panic(err)
		}
	}

	router := gin.Default()
	router.Use(cors.Default())
	router.GET("/health", func(ctx *gin.Context) { ctx.Status(http.StatusOK) })
	router.GET("/count", getCount)
	fmt.Print("loaded")
	router.Run("0.0.0.0:" + fmt.Sprint(config.Port))
}
