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
            const sortedMembers = members.map(m => m.memberId).sort()
            const membersCount = sortedMembers.length
            const assignment: Record<string, Assignment> = {};

            for (const topic of topics) {
                const partitionMetadata = cluster.findTopicPartitionMetadata(topic)
                const numPartitionsForTopic = partitionMetadata.length
                const numPartitionsPerConsumer = Math.floor(numPartitionsForTopic / membersCount)
                const consumersWithExtraPartition = numPartitionsForTopic % membersCount

                for (let i = 0; i < membersCount; i++) {
                    const start = numPartitionsPerConsumer * i + Math.min(i, consumersWithExtraPartition)
                    const length = numPartitionsPerConsumer + (i < consumersWithExtraPartition ? 1 : 0)
                    const assignee = sortedMembers[i]

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
