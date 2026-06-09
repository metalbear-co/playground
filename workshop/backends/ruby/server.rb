# MetalMart inventory-service — workshop Ruby variant (canned data, stdlib only).
#
# You STEAL the in-cluster inventory-service (Node) and run THIS Ruby copy on your laptop.
# Edit the marked line and refresh your browser.
#
# Run:  mirrord exec -f ../mirrord-core.json -- ruby server.rb
require "socket"
require "json"

PORT = 8080 # mirrord maps remote :80 -> local :8080

PRODUCTS = [
  { "id" => 1, "name" => "MetalBear Hoodie",      "description" => "Cozy heavyweight hoodie with the MetalBear mascot.",       "price_cents" => 5900, "stock" => 42,  "is_new" => true },
  { "id" => 2, "name" => "Steal the Show Tee",     "description" => "Soft cotton tee. Run your laptop as if it were a pod.",    "price_cents" => 2900, "stock" => 80,  "is_new" => true },
  { "id" => 3, "name" => "mirrord Mug",            "description" => "Ceramic mug for your morning cluster session.",           "price_cents" => 1500, "stock" => 120, "is_new" => false },
  { "id" => 4, "name" => "Cluster Cap",            "description" => "Embroidered cap. Outgoing traffic, incoming compliments.", "price_cents" => 2400, "stock" => 65,  "is_new" => false },
  { "id" => 5, "name" => "Bear Claw Sticker Pack", "description" => "Six die-cut vinyl stickers.",                            "price_cents" => 800,  "stock" => 300, "is_new" => false },
  { "id" => 6, "name" => "Plush mirrord Bear",     "description" => "Huggable plush. Mirrors your affection bidirectionally.",  "price_cents" => 3200, "stock" => 33,  "is_new" => false },
  { "id" => 7, "name" => "Enamel Pin Set",         "description" => "Three hard-enamel pins.",                                "price_cents" => 1800, "stock" => 90,  "is_new" => false },
  { "id" => 8, "name" => "DevOps Beanie",          "description" => "Keep your head warm while the operator does the work.",    "price_cents" => 2200, "stock" => 54,  "is_new" => false },
]

# 👇 EDIT ME — set PREFIX to "🔥 " (or "SALE! "), save, and refresh your browser.
PREFIX = ""

def render(p)
  p.merge("name" => PREFIX + p["name"])
end

host = Socket.gethostname
server = TCPServer.new("0.0.0.0", PORT)
puts "inventory (ruby) on :#{PORT}"

loop do
  client = server.accept
  Thread.new(client) do |sock|
    request_line = sock.gets
    while (line = sock.gets) && line != "\r\n"; end # drain headers
    path = request_line ? request_line.split(" ")[1] : "/"
    if path == "/health"
      body, ctype = "ok", "text/plain"
    elsif path.start_with?("/products")
      body, ctype = JSON.generate(PRODUCTS.map { |p| render(p) }), "application/json"
    else
      sock.print "HTTP/1.1 404 Not Found\r\nX-Served-By: #{host}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      sock.close
      next
    end
    sock.print "HTTP/1.1 200 OK\r\nX-Served-By: #{host}\r\nContent-Type: #{ctype}\r\n" \
               "Content-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"
    sock.close
  end
end
