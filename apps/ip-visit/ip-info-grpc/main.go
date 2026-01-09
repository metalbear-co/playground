package main

import (
	"context"
	"fmt"
	"log"
	"net"

	pb "github.com/metalbear-co/playground/protogen"
	"github.com/spf13/viper"
	"google.golang.org/grpc"
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

type server struct {
	pb.UnimplementedIpInfoServiceServer
}

func (s *server) GetIpInfo(ctx context.Context, req *pb.IpRequest) (*pb.IpResponse, error) {
	ip := req.GetIp()

	for _, info := range ipInfos {
		if info.Ip == ip {
			return &pb.IpResponse{Ip: info.Ip, Info: info.Info}, nil
		}
	}
	return &pb.IpResponse{Ip: ip, Info: "Unknown"}, nil
}

func main() {
	config := loadConfig()

	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", config.Port))
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	s := grpc.NewServer()
	pb.RegisterIpInfoServiceServer(s, &server{})

	fmt.Printf("gRPC server listening on port %d\n", config.Port)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
