# SharePoint Streaming Upload — Input Consumption Probe

Use this temporary diagnostic wrapper around the servlet `InputStream` immediately
before passing it to the Apache HttpClient upload request.

```java
InputStream trackingStream = new FilterInputStream(inputStream) {

    private long totalRead;
    private long nextLogAt = 10 * 1024 * 1024L;
    private boolean eofLogged;

    private void record(int bytesRead) {
        if (bytesRead == -1) {
            if (!eofLogged) {
                eofLogged = true;
                log.info("UPLOAD PROBE: incoming stream finished, total={} bytes",
                        totalRead);
            }
            return;
        }

        totalRead += bytesRead;

        if (totalRead >= nextLogAt) {
            log.info("UPLOAD PROBE: Apache consumed {} MB from browser stream",
                    totalRead / 1024 / 1024);

            nextLogAt += 10 * 1024 * 1024L;
        }
    }

    @Override
    public int read(byte[] buffer, int offset, int length)
            throws IOException {
        int bytesRead = super.read(buffer, offset, length);
        record(bytesRead);
        return bytesRead;
    }

    @Override
    public int read() throws IOException {
        int value = super.read();
        record(value == -1 ? -1 : 1);
        return value;
    }
};
```

Pass `trackingStream`, not the original `inputStream`, to the streamed request entity:

```java
request.setEntity(
        new BasicHttpEntity(
                trackingStream,
                contentLength,
                ContentType.APPLICATION_OCTET_STREAM
        )
);
```

Add temporary lifecycle logs around the synchronous SharePoint call:

```java
log.info("UPLOAD PROBE: starting SharePoint request, declared={} bytes",
        contentLength);

SharePointFileResponse response = httpClient.execute(
        request,
        responseHandler
);

log.info("UPLOAD PROBE: SharePoint response received");
```

## How to interpret the logs

- Logs appearing progressively while the browser is still uploading show that Apache
  is consuming the inbound servlet stream incrementally.
- `incoming stream finished` means Apache has read the complete browser request body.
  It does not mean SharePoint has committed the file.
- The time between `incoming stream finished` and `SharePoint response received` is
  the final SharePoint transfer/processing/commit period visible to Angular as
  `finalizing`.
- This probe does not prove that SharePoint acknowledged each logged block. It proves
  only that Apache consumed those bytes from the servlet stream for its outbound
  request.
- If all consumption logs appear together only after Angular reaches 100%, inspect the
  controller, servlet filters, reverse proxy, and load balancer for request buffering.
- If JVM heap grows by approximately the complete file size per concurrent upload,
  search for `byte[]`, `readAllBytes()`, `ByteArrayInputStream`, `ByteArrayEntity`,
  `ByteArrayOutputStream`, multipart buffering, or a content-caching request wrapper.

Remove this diagnostic wrapper and its logs after the streaming behavior is verified.
Do not log file contents, access tokens, or complete request URLs containing sensitive
information.
