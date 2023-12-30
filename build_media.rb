#!/usr/bin/env ruby

require 'time'
require 'date'
require 'find'
require 'json'

json = []

Find.find('./media/VRChat') {|f|
  if FileTest.directory?(f)
    next
  end

  basename = File.basename(f)
  basename = basename.delete_prefix("VRChat_")
  basename = basename.delete_suffix(".png")
  basename = basename.split("_")

  date = basename[0]
  time = basename[1].gsub('-', ':')

  timezone = "+09:00"

  date = "#{date}T#{time}#{timezone}"
  date = DateTime.parse(date).iso8601(3)

  world = "VRChat"
  tags = ["VRChat"]

  camera = {make: "logilabo", model: "VirtualLens2"}

  json << {file: f.delete_prefix("."), world: world, camera: camera, timestamp: date, tags: tags}
}

Find.find('./media') {|f|
  Find.prune if f == "./media/VRChat"
  Find.prune if f == "./media/.gitkeep"
  Find.prune if f == "./media/media.json"
  if FileTest.directory?(f)
    next
  end

  camera = nil
  date = nil
  tags = ['film']

  json << {file: f.delete_prefix("."), world: "Real", camera: camera, timestamp: date, tags: tags}
}

json = JSON.pretty_generate(json)
File.open('./media/media.json', 'w') do |f|
  f.write(json)
end