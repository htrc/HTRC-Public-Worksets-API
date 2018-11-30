# HTRC-Worksets-API
API for working with worksets in Virtuoso

# Docker Notes
After you update your NodeJS app, we have to create a new container version and replace the existing running container. 
You do this as follows:

## Step 1
`docker build -t htrc/worksets-api:0.2.0 -t htrc/worksets-api:latest .`  

Run this in your development folder, where the `Dockerfile` is. This instructs Docker to 
build a new image from `.` (the current folder) and tag it `-t` with the specified identifiers.  
`0.2.0` is a version number -- when you make code changes, you should update that for each 
Docker image you create. (you can use `docker images` to get a listing of existing Docker images in the system).

## Step 2
```
cd /opt/virtuoso-compose
docker-compose up -d
```

This should detect the changes in your image and redeploy the new version.
When you in that `/opt/virtuoso-compose` folder, you can also run `docker-compose logs` or 
`docker-compose logs -f` if you want to see or tail the output from the containers, respectively.


**Note:** When you build the new image version, it's important to tag it with the `latest` tag also 
(in the command above, the part `-t htrc/worksets-api:latest` is important -- since the `latest` tag is 
used by the `docker-compose` to get the latest version of the image)  

If you don't want to `cd /opt/virtuoso-compose`, you can also run the `docker-compose` from anywhere like this:  
```docker-compose -f /opt/virtuoso-compose/docker-compose.yml -p htrc <command>```  
where `<command>` can be `up -d` or `logs` or `logs -f`..etc.
