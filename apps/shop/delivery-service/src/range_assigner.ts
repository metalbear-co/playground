import { PartitionAssigner, GroupMember, AssignerProtocol, Assignment } from "kafkajs"

/**
 * Stolen from KafkaJS fork at https://github.com/pimpelsang/kafkajs/blob/7d873095c5ef51832b5914a26923748cd5b04ef6/src/consumer/assigners/rangeAssigner/index.js.
 */
export const range: PartitionAssigner = ({ cluster }) => {
    return {
        name: "RangeAssigner",
        version: 0,
        async assign({ members, topics }: { members: GroupMember[]; topics: string[] }) {
            const sortedMembers = members.map(({ memberId }) => memberId).sort()
            const membersCount = sortedMembers.length
            const assignment: { [key:string]: Assignment } = {};

            for (const topic of topics) {
                const partitionMetadata = cluster.findTopicPartitionMetadata(topic)

                const numPartitionsForTopic = partitionMetadata.length
                const numPartitionsPerConsumer = Math.floor(numPartitionsForTopic / membersCount)
                const consumersWithExtraPartition = numPartitionsForTopic % membersCount

                for (var i = 0; i < membersCount; i++) {
                    const start = numPartitionsPerConsumer * i + Math.min(i, consumersWithExtraPartition)
                    const length = numPartitionsPerConsumer + (i + 1 > consumersWithExtraPartition ? 0 : 1)

                    const assignee = sortedMembers[i]

                    for (let partition = start; partition < start + length; partition++) {
                        if (!assignment[assignee]) {
                            assignment[assignee] = {}
                        }

                        if (!assignment[assignee][topic]) {
                            assignment[assignee][topic] = []
                        }

                        assignment[assignee][topic].push(partition)
                    }
                }
            }

            return Object.keys(assignment).map(memberId => ({
                memberId,
                memberAssignment: AssignerProtocol.MemberAssignment.encode({
                    version: this.version,
                    assignment: assignment[memberId],
                    userData: Buffer.alloc(0),
                }),
            }))
        },
        protocol({ topics }: { topics: string[] }) {
            return {
                name: this.name,
                metadata: AssignerProtocol.MemberMetadata.encode({
                    version: this.version,
                    topics,
                    userData: Buffer.alloc(0),
                }),
            }
        },
    }
}
