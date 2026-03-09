import { PartitionAssigner, AssignerProtocol, Assignment } from "kafkajs"

/**
 * Stolen from KafkaJS fork at https://github.com/pimpelsang/kafkajs/blob/7d873095c5ef51832b5914a26923748cd5b04ef6/src/consumer/assigners/rangeAssigner/index.js.
 */
export const range: PartitionAssigner = ({ cluster }) => {
    const name = "range"
    const version = 0

    return {
        name: name,
        version: version,
        async assign({ members, topics }) {
            const memberMetadata = new Map(
                members.map(m => [
                    m.memberId,
                    AssignerProtocol.MemberMetadata.decode(m.memberMetadata).topics ?? [],
                ])
            )
            const assignment: Record<string, Assignment> = {};

            for (const topic of topics) {
                const subscribedMembers = members
                    .filter(m => memberMetadata.get(m.memberId)?.includes(topic))
                    .map(m => m.memberId)
                    .sort()
                const membersCount = subscribedMembers.length
                if (membersCount === 0) continue

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
                    assignment: assignment[memberId],
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
