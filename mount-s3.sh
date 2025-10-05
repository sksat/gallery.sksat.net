#!/bin/bash

s3fs sksat-gallery ./mnt -o passwd_file=.b2-passwd -o url=https://s3.us-west-002.backblazeb2.com
