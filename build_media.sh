#!/bin/bash
cd `dirname $0`

find media -type f \
  | awk '{print prefix $1 }' prefix="/" \
  | jq -R '{number:input_line_number, file:.}' \
  | jq -s . \
  > media/media.json