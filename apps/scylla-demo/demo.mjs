// Reads and changes the demo keyspace through whatever SCYLLA_HOST points at.
// Under mirrord that is the branch: node demo.mjs [list|add|wipe]
import cassandra from 'cassandra-driver';

const { SCYLLA_HOST, SCYLLA_PORT = '9042', SCYLLA_KEYSPACE, SCYLLA_DC } = process.env;
const client = new cassandra.Client({
  contactPoints: [`${SCYLLA_HOST}:${SCYLLA_PORT}`],
  localDataCenter: SCYLLA_DC,
  keyspace: SCYLLA_KEYSPACE,
});

await client.connect();
console.log(`connected to ${SCYLLA_HOST}:${SCYLLA_PORT}, keyspace ${SCYLLA_KEYSPACE}, dc ${SCYLLA_DC}`);

const action = process.argv[2] ?? 'list';
if (action === 'add') {
  await client.execute(
    'INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)',
    ['BRANCH-ONLY', 'Only on my branch', 100, 1],
    { prepare: true },
  );
} else if (action === 'wipe') {
  await client.execute('TRUNCATE products');
}

const { rows } = await client.execute('SELECT sku, name, stock FROM products');
console.table(rows.map(({ sku, name, stock }) => ({ sku, name, stock })));
await client.shutdown();
