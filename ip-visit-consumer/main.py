import os
import time
from flask import Flask, jsonify
from confluent_kafka import Consumer, KafkaException, KafkaError
import threading

run = True


# Load configuration
class Config:
    def __init__(self):
        self.port = int(os.getenv("PORT", 5000))
        self.kafka_address = os.getenv("KAFKAADDRESS", "localhost:9092")
        self.kafka_topic = os.getenv("KAFKATOPIC", "default-topic")
        self.kafka_consumer_group = os.getenv("KAFKACONSUMERGROUP", "default-group")

# Kafka consumer function
def start_kafka_reader(address, topic, group):
    consumer = Consumer({
        'bootstrap.servers': address,
        'group.id': group,
        "debug": os.getenv("KAFKA_DEBUG")
    })

    consumer.subscribe([topic])

    global run
    while run:
        msg = consumer.poll(1.0)

        if msg is None:
            print("No message received")
            continue
        if msg.error():
            print("Consumer error: {}".format(msg.error()))
            continue

        print('Received message: {msg}')

    consumer.close()

# Flask app
app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    if not run:
        return jsonify({"status": "error", "message": "Consumer is not running"}), 500
    else:
        return jsonify({"status": "ok"}), 200

if __name__ == "__main__":
    config = Config()

    # Start Kafka reader in a separate thread
    kafka_thread = threading.Thread(target=start_kafka_reader, args=(config.kafka_address, config.kafka_topic, config.kafka_consumer_group))
    kafka_thread.daemon = True
    kafka_thread.start()

    print("Loaded")
    app.run(host="0.0.0.0", port=config.port)