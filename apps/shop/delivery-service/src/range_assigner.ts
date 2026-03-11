import { PartitionAssigner, AssignerProtocol, Assignment } from "kafkajs"

/**
 * Range partition assigner that respects topic subscriptions.
 * Based on https://github.com/pimpelsang/kafkajs/blob/7d873095c5ef51832b5914a26923748cd5b04ef6/src/consumer/assigners/rangeAssigner/index.js
 *
 * Unlike the original, this:
 * 1. Builds the full topic list from all members' metadata (kafkajs only
 *    passes the local consumer's topics, but we need the union for split_queues).
 * 2. Filters members per topic by subscription. Members whose metadata can't
 *    be decoded (e.g. librdkafka operator) are included in all topics as a
 *    safe fallback.
 */
export const range: PartitionAssigner = ({ cluster }) => {
    const name = "range"
    const version = 0

    return {
        name: name,
        version: version,
        async assign({ members, topics }) {
            const assignment: Record<string, Assignment> = {};

            // Decode each member's subscribed topics. If decoding fails
            // (e.g. librdkafka metadata format), set to null to include
            // in all topics as a safe default.
            const memberTopics = new Map<string, Set<string> | null>();
            for (const m of members) {
                try {
                    const metadata = AssignerProtocol.MemberMetadata.decode(m.memberMetadata);
                    if (metadata?.topics && metadata.topics.length > 0) {
                        memberTopics.set(m.memberId, new Set(metadata.topics));
                    } else {
                        memberTopics.set(m.memberId, null);
                    }
                } catch {
                    memberTopics.set(m.memberId, null);
                }
            }

            // Build the FULL topic list from all members' metadata.
            // kafkajs only passes the local consumer's topics, but we need
            // the union of all members' topics to assign correctly.
            const allTopics = new Set(topics);
            for (const subs of memberTopics.values()) {
                if (subs) {
                    for (const t of subs) allTopics.add(t);
                }
            }

            // Ensure cluster has metadata for all topics
            for (const t of allTopics) {
                await cluster.addTargetTopic(t);
            }

            for (const topic of allTopics) {
                // Filter to members subscribed to this topic, or whose
                // metadata couldn't be decoded (null = include everywhere).
                const subscribedMembers = members
                    .map(m => m.memberId)
                    .filter(id => {
                        const subs = memberTopics.get(id);
                        return subs === null || subs === undefined || subs.has(topic);
                    })
                    .sort();

                const membersCount = subscribedMembers.length;
                if (membersCount === 0) continue;

                const partitionMetadata = cluster.findTopicPartitionMetadata(topic)
                const numPartitionsForTopic = partitionMetadata.length
                const numPartitionsPerConsumer = Math.floor(numPartitionsForTopic / membersCount)
                const consumersWithExtraPartition = numPartitionsForTopic % membersCount

                for (let i = 0; i < membersCount; i++) {
                    const start = numPartitionsPerConsumer * i + Math.min(i, consumersWithExtraPartition)
                    const length = numPartitionsPerConsumer + (i < consumersWithExtraPartition ? 1 : 0)
                    const assignee = subscribedMembers[i]

                    for (let partition = start; partition < start + length; partition++) {
                        assignment[assignee] ??= {}
                        assignment[assignee][topic] ??= []
                        assignment[assignee][topic].push(partition)
                    }
                }
            }

            return Object.keys(assignment).map(memberId => ({
                memberId,
                memberAssignment: AssignerProtocol.MemberAssignment.encode({
                    version,
                    assignment: assignment[memberId] ?? {},
                    userData: Buffer.alloc(0),
                }),
            }))
        },
        protocol({ topics }) {
            return {
                name,
                metadata: AssignerProtocol.MemberMetadata.encode({
                    version,
                    topics,
                    userData: Buffer.alloc(0),
                }),
            }
        },
    }
}
