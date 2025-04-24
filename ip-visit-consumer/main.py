import os
import time
from flask import Flask, jsonify
import sys
from confluent_kafka import Consumer
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
    options = {
        'bootstrap.servers': address,
        'group.id': group,
    }
    if os.getenv("KAFKA_DEBUG"):
        options['debug'] = os.getenv("KAFKA_DEBUG")

    consumer = Consumer(options)

    consumer.subscribe([topic])

    global run
    while run:
        msg = consumer.poll(10.0)
        if msg is None:
            print("No message received", flush=True)
            continue
        if msg.error():
            print("Consumer error: {}".format(msg.error()), file=sys.stderr)
            continue

        print('Received message: with headers', msg.value(), msg.headers(), flush=True)

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