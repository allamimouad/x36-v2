# SharePoint Document URL Builder — Refactoring Prompt

I need you to refactor the existing SharePoint document URL generation code carefully. Do not perform a broad redesign and do not modify unrelated code.

## Context

The backend returns a file DTO containing these three properties:

- onlineUrl
- desktopUrl
- downloadUrl

The current implementation uses a class named approximately:

- SharePointDocumentUrlBuilder

It is called from the SharePoint document mapper, probably:

- SharePointDocumentListingMapper

There may already be a MapStruct context such as:

- SharePointDocumentMappingContext

The application uses Spring Boot, MapStruct, SharePoint REST responses, and Spring Cloud OpenFeign.

The current URL builder manually parses URLs using substring(), indexOf(), split(), StringBuilder, URLEncoder, and a method similar to:

- addOrUpdateQueryParameter(...)

That implementation must be replaced because it manually reimplements URI parsing and currently contains fragile or incorrect index calculations.

## Main objective

Refactor the URL generation to use Spring's UriComponentsBuilder.

The final design must:

1. Use UriComponentsBuilder instead of manual scheme, authority, path, query, or fragment parsing.
2. Remove addOrUpdateQueryParameter().
3. Remove other manual URL reconstruction logic that is no longer necessary.
4. Avoid using URLEncoder directly.
5. Avoid calling URI.create() with an unencoded path containing spaces.
6. Encode URLs exactly once.
7. Preserve the existing DTO fields and existing functional behavior.
8. Keep the refactor limited to URL generation, mapping context, mapper integration, tests, and the required Maven dependency.

Before editing, inspect the existing DTO, mapper, service, mapping context, properties class, builder, and tests so that the changes integrate with the existing code rather than duplicating existing structures.

---

## 1. Add the explicit Maven dependency

In the Maven module that directly imports UriComponentsBuilder, add:

<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-web</artifactId>
</dependency>

Do not specify a version. The version must remain controlled by Spring Boot dependency management.

Do not add spring-boot-starter-web merely for UriComponentsBuilder.

spring-web may already be present transitively through OpenFeign, but because our code directly imports it, it must be declared explicitly.

---

## 2. Architecture and responsibilities

The SharePointDocumentUrlBuilder must be a pure URL-construction component.

It must:

- not perform HTTP calls;
- not perform database calls;
- not resolve SharePoint lists;
- not read SharePoint configuration directly;
- not inject SharePointProperties;
- not derive the site by guessing "/sites/{siteName}";
- receive an already resolved absolute site URI.

Use or update a mapping context similar to:

public record SharePointDocumentMappingContext(URI siteUrl) {
    public SharePointDocumentMappingContext {
        Objects.requireNonNull(siteUrl, "siteUrl must not be null");

        if (!siteUrl.isAbsolute()) {
            throw new IllegalArgumentException("siteUrl must be absolute");
        }
    }
}

If an equivalent context class already exists, modify it instead of creating a duplicate.

The application/service layer must resolve the full site URL once and pass it through the MapStruct @Context.

For example, the builder should receive:

- siteUrl:
  https://sharepoint.example.com/sites/MMAAE00001

- serverRelativeUrl:
  /sites/MMAAE00001/Shared Documents/My File.docx

Do not continue passing both siteName and serverRelativeUrl to the builder. The server-relative URL already contains the complete SharePoint path.

The service may resolve the absolute site URI from configuration and site name, but the builder itself must not know how configuration is structured.

---

## 3. Required builder API

Refactor SharePointDocumentUrlBuilder toward the following API:

@Component
public class SharePointDocumentUrlBuilder {

    public String buildOnlineUrl(
            URI siteUrl,
            String serverRelativeUrl,
            String fileName
    ) {
        // implementation
    }

    public String buildDesktopUrl(
            URI siteUrl,
            String serverRelativeUrl,
            String fileName
    ) {
        // implementation
    }

    public String buildDownloadUrl(
            URI siteUrl,
            String serverRelativeUrl
    ) {
        // implementation
    }
}

Use the existing project naming conventions if they differ slightly, but preserve these responsibilities and input types.

Do not inject SharePointProperties into this builder.

---

## 4. Input contract

Treat serverRelativeUrl as a decoded server-relative SharePoint path.

Example:

/sites/MMAAE00001/Shared Documents/My File.docx

It is not expected to contain:

- a scheme;
- a host;
- a query string;
- a fragment.

Do not add complicated heuristics to detect whether the path was previously encoded.

Document this contract in Javadoc.

Normalize only the leading slash:

private String normalizeServerRelativeUrl(String serverRelativeUrl) {
    if (serverRelativeUrl == null || serverRelativeUrl.isBlank()) {
        throw new IllegalArgumentException(
                "serverRelativeUrl must not be blank"
        );
    }

    return serverRelativeUrl.startsWith("/")
            ? serverRelativeUrl
            : "/" + serverRelativeUrl;
}

---

## 5. Canonical absolute document URL

Create one private method that combines:

- the scheme, host, and port from siteUrl;
- the full path from serverRelativeUrl.

The path from siteUrl must be replaced because serverRelativeUrl already contains the complete server-relative SharePoint path.

Use this structure:

private URI buildCanonicalUrl(
        URI siteUrl,
        String serverRelativeUrl
) {
    Objects.requireNonNull(siteUrl, "siteUrl must not be null");

    if (!siteUrl.isAbsolute()) {
        throw new IllegalArgumentException("siteUrl must be absolute");
    }

    String normalizedPath =
            normalizeServerRelativeUrl(serverRelativeUrl);

    return UriComponentsBuilder.fromUri(siteUrl)
            .replacePath(normalizedPath)
            .replaceQuery(null)
            .fragment(null)
            .build()
            .encode()
            .toUri();
}

The resulting URI must preserve:

- scheme;
- host;
- optional port.

It must correctly encode spaces and special characters in the path.

Do not reconstruct the authority using substring().

Do not assume that SharePoint always uses "/sites". The implementation must also work for "/teams", custom managed paths, root sites, or subwebs because serverRelativeUrl contains the full path.

---

## 6. Supported Office extensions

The current supported extensions are:

- doc
- docx
- docm
- xls
- xlsx
- xlsm
- xlsb
- ppt
- pptx
- pptm
- ppsx

Preserve this set unless the current project explicitly defines a different approved set.

Do not maintain both:

- ONLINE_EXTENSIONS
- OFFICE_PROTOCOLS

with duplicated extension data.

Use one immutable map as the source of truth:

private static final Map<String, String> OFFICE_PROTOCOL_BY_EXTENSION =
        Map.ofEntries(
                Map.entry("doc", "ms-word"),
                Map.entry("docx", "ms-word"),
                Map.entry("docm", "ms-word"),

                Map.entry("xls", "ms-excel"),
                Map.entry("xlsx", "ms-excel"),
                Map.entry("xlsm", "ms-excel"),
                Map.entry("xlsb", "ms-excel"),

                Map.entry("ppt", "ms-powerpoint"),
                Map.entry("pptx", "ms-powerpoint"),
                Map.entry("pptm", "ms-powerpoint"),
                Map.entry("ppsx", "ms-powerpoint")
        );

Use Locale.ROOT when normalizing extensions.

Use direct extension extraction rather than iterating over every map entry with endsWith():

private String getExtension(String fileName) {
    if (fileName == null || fileName.isBlank()) {
        return null;
    }

    int dotIndex = fileName.lastIndexOf('.');

    if (dotIndex < 0 || dotIndex == fileName.length() - 1) {
        return null;
    }

    return fileName.substring(dotIndex + 1)
            .toLowerCase(Locale.ROOT);
}

private String getOfficeProtocol(String fileName) {
    String extension = getExtension(fileName);

    return extension == null
            ? null
            : OFFICE_PROTOCOL_BY_EXTENSION.get(extension);
}

For the current behavior, online support can use the same approved extension map:

private boolean supportsOnline(String fileName) {
    return getOfficeProtocol(fileName) != null;
}

Do not introduce another duplicated Set.

---

## 7. Online URL

The online URL must:

1. Return null for unsupported file types.
2. Build the canonical absolute document URL.
3. Add or replace the query parameter web=1.
4. Preserve valid URL encoding.
5. Never manually parse query parameters.

Use this implementation pattern:

public String buildOnlineUrl(
        URI siteUrl,
        String serverRelativeUrl,
        String fileName
) {
    if (!supportsOnline(fileName)) {
        return null;
    }

    URI canonicalUrl =
            buildCanonicalUrl(siteUrl, serverRelativeUrl);

    return UriComponentsBuilder.fromUri(canonicalUrl)
            .replaceQueryParam("web", "1")
            .build(true)
            .toUriString();
}

Do not recreate addOrUpdateQueryParameter().

Expected example:

Input:

siteUrl:
https://sharepoint.example.com/sites/MMAAE00001

serverRelativeUrl:
/sites/MMAAE00001/Shared Documents/My File.docx

Output:

https://sharepoint.example.com/sites/MMAAE00001/Shared%20Documents/My%20File.docx?web=1

---

## 8. Desktop URL

Use the Office URI scheme:

- Word: ms-word
- Excel: ms-excel
- PowerPoint: ms-powerpoint

The required format is:

{protocol}:ofe|u|{absoluteEncodedDocumentUrl}

Define:

private static final String OFFICE_PROTOCOL_PREFIX = "ofe|u|";

Implementation pattern:

public String buildDesktopUrl(
        URI siteUrl,
        String serverRelativeUrl,
        String fileName
) {
    String protocol = getOfficeProtocol(fileName);

    if (protocol == null) {
        return null;
    }

    URI canonicalUrl =
            buildCanonicalUrl(siteUrl, serverRelativeUrl);

    return protocol
            + ":"
            + OFFICE_PROTOCOL_PREFIX
            + canonicalUrl.toASCIIString();
}

Expected Word example:

ms-word:ofe|u|https://sharepoint.example.com/sites/MMAAE00001/Shared%20Documents/My%20File.docx

Return null for unsupported file types such as PDF.

---

## 9. Download URL

The download endpoint belongs to the resolved SharePoint site:

{siteUrl}/_layouts/15/download.aspx

The decoded server-relative path must be passed as the SourceUrl query parameter and encoded exactly once.

Use this implementation pattern:

public String buildDownloadUrl(
        URI siteUrl,
        String serverRelativeUrl
) {
    Objects.requireNonNull(siteUrl, "siteUrl must not be null");

    String normalizedPath =
            normalizeServerRelativeUrl(serverRelativeUrl);

    return UriComponentsBuilder.fromUri(siteUrl)
            .replaceQuery(null)
            .fragment(null)
            .pathSegment("_layouts", "15", "download.aspx")
            .queryParam("SourceUrl", normalizedPath)
            .build()
            .encode()
            .toUriString();
}

Ensure that a trailing slash on siteUrl does not produce an invalid double slash.

Expected logical output:

https://sharepoint.example.com/sites/MMAAE00001/_layouts/15/download.aspx?SourceUrl=%2Fsites%2FMMAAE00001%2FShared%20Documents%2FMy%20File.docx

The exact escaping produced by the installed Spring version should be asserted in tests.

downloadUrl must still be generated for unsupported Office extensions such as PDF because download support is not restricted to Office file types.

---

## 10. Mapper integration

Update the existing MapStruct mapper rather than creating a second mapper.

The mapper must receive the existing or updated context through @Context:

SharePointDocumentMappingContext context

It must call the builder using:

context.siteUrl()

Examples:

urlBuilder.buildOnlineUrl(
        context.siteUrl(),
        source.getServerRelativeUrl(),
        source.getName()
)

urlBuilder.buildDesktopUrl(
        context.siteUrl(),
        source.getServerRelativeUrl(),
        source.getName()
)

urlBuilder.buildDownloadUrl(
        context.siteUrl(),
        source.getServerRelativeUrl()
)

Adapt getter names to the real SharePoint response model.

Do not perform configuration lookup or URL parsing inside MapStruct expressions.

Do not make the mapper perform HTTP calls.

Do not create a new builder instance manually. Use the project's existing Spring/MapStruct component model.

Preserve the current mapping of all unrelated DTO fields.

---

## 11. Service integration

Find the service that currently knows:

- the site name;
- SharePointProperties;
- the configured sites base URL;
- the current document list/site.

Resolve the absolute site URI there, once.

For example, if properties.getSitesBaseUrl() is:

https://sharepoint.example.com/sites

and siteName is:

MMAAE00001

then an acceptable pattern is:

URI siteUrl = UriComponentsBuilder
        .fromUriString(properties.getSitesBaseUrl())
        .pathSegment(siteName)
        .build()
        .encode()
        .toUri();

However, inspect the exact configuration semantics first.

Do not blindly append siteName if the configured value already contains the complete site URL.

Pass the resolved site URI in:

new SharePointDocumentMappingContext(siteUrl)

The URL builder must not receive siteName or SharePointProperties.

---

## 12. Remove obsolete code

After the refactor, remove code that has become unused, including as applicable:

- addOrUpdateQueryParameter(...)
- resolveCanonicalPath(...) if replaced
- URLEncoder imports
- StandardCharsets imports used only by URLEncoder
- duplicated ONLINE_EXTENSIONS
- buildOfficeProtocols() if an immutable constant replaces it
- injected SharePointProperties field
- builder constructor receiving SharePointProperties
- manual scheme/authority/path/query/fragment parsing

Do not leave dead private methods or unused imports.

---

## 13. Tests

Add or update focused unit tests for SharePointDocumentUrlBuilder.

Prefer JUnit 5 parameterized tests where useful.

At minimum, test:

1. Lowercase Word extension:
   file.docx

2. Uppercase extension:
   FILE.DOCX

3. Filename containing multiple dots:
   financial.report.final.xlsx

4. Filename without an extension.

5. Filename ending with a dot.

6. Unsupported extension:
   file.pdf

7. Path containing spaces:
   /sites/MMAAE00001/Shared Documents/My File.docx

8. Path containing ampersand:
   /sites/MMAAE00001/Documents/R&D Report.docx

9. Path containing plus:
   /sites/MMAAE00001/Documents/A+B.docx

10. Path containing characters that require path encoding.

11. serverRelativeUrl without an initial slash.

12. siteUrl containing a non-default port.

13. siteUrl with a trailing slash.

14. A "/teams/..." server-relative URL to prove that the builder does not assume "/sites".

15. onlineUrl contains exactly one web=1 parameter.

16. desktopUrl uses the correct protocol for Word, Excel, and PowerPoint.

17. onlineUrl and desktopUrl return null for unsupported extensions.

18. downloadUrl is generated for unsupported extensions.

19. null or blank serverRelativeUrl throws IllegalArgumentException.

20. a non-absolute siteUrl is rejected.

Use a main test example equivalent to:

private static final URI SITE_URL =
        URI.create(
                "https://sharepoint.example.com/sites/MMAAE00001"
        );

private static final String SERVER_RELATIVE_URL =
        "/sites/MMAAE00001/Shared Documents/My File.docx";

Expected online URL:

https://sharepoint.example.com/sites/MMAAE00001/Shared%20Documents/My%20File.docx?web=1

Expected desktop URL:

ms-word:ofe|u|https://sharepoint.example.com/sites/MMAAE00001/Shared%20Documents/My%20File.docx

Expected download URL should point to:

https://sharepoint.example.com/sites/MMAAE00001/_layouts/15/download.aspx

and contain the correctly encoded SourceUrl query parameter.

Do not write tests that merely reproduce implementation details. Assert the resulting public URL strings.

---

## 14. Restrictions

Do not:

- modify unrelated DTO properties;
- change API endpoint contracts;
- rename public DTO fields;
- introduce HTTP calls;
- introduce a new external URL library;
- use java.net.URLEncoder;
- manually split URLs;
- manually calculate scheme or authority indexes;
- use substring-based query manipulation;
- add spring-boot-starter-web;
- add a dependency version manually;
- duplicate extension lists;
- assume all SharePoint sites use "/sites";
- silently accept a relative siteUrl;
- double-encode an already constructed URI;
- refactor unrelated SharePoint logic.

Keep the implementation straightforward and maintainable. Do not add abstractions that are not required by this task.

---

## 15. Final verification

After implementation:

1. Run the relevant module tests.
2. Run compilation for the affected Maven module.
3. Remove all unused imports and dead methods.
4. Show me the exact files changed.
5. Summarize the responsibility of each changed class.
6. Show the final SharePointDocumentUrlBuilder code.
7. Show how the service creates SharePointDocumentMappingContext.
8. Show how the mapper calls the builder.
9. Mention any assumption you had to make about properties.getSitesBaseUrl().
10. Do not claim tests passed unless you actually ran them successfully.

Implement the changes now.
