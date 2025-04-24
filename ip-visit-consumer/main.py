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
        'auto.offset.reset': 'earliest',
        "debug": "all"
    })

    consumer.subscribe([topic])

    global run
    while run:
        try:
            msg = consumer.poll(1.0)  # Poll for messages with a timeout of 1 second
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    # End of partition event
                    print(f"Reached end of partition: {msg.topic()} [{msg.partition()}]")
                elif msg.error():
                    run = False
                    raise KafkaException(msg.error())
            else:
                # Proper message
                print(f"Message on {msg.topic()} [{msg.partition()}]: {msg.value().decode('utf-8')}")
        except Exception as e:
            print(f"Consumer error: {e}")
            run = False

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