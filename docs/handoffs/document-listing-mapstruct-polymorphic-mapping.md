# Document Listing — Move Polymorphic Response Mapping into MapStruct

Refactor the existing document-listing/search response mapping so the controller no
longer selects file-versus-folder response types.

Inspect the current controller, `DocumentListingMapper`, domain types, response DTOs,
and installed MapStruct version before editing. Reuse the project's actual names,
imports, mapper configuration, and conventions.

## Required implementation

Keep the existing domain and API response hierarchy:

```text
DocumentListing.DocumentNode
├── DocumentListing.FileNode
└── DocumentListing.FolderNode

DocumentListingResponse.DocumentNodeResponse
├── DocumentListingResponse.FileNodeResponse
└── DocumentListingResponse.FolderNodeResponse
```

When the installed MapStruct version supports `@SubclassMapping`, move subtype
dispatch into `DocumentListingMapper` using the equivalent of:

```java
@Mapper(
    componentModel = MappingConstants.ComponentModel.SPRING,
    unmappedTargetPolicy = ReportingPolicy.ERROR,
    subclassExhaustiveStrategy = SubclassExhaustiveStrategy.RUNTIME_EXCEPTION
)
public interface DocumentListingMapper {

    @SubclassMapping(
        source = DocumentListing.FileNode.class,
        target = DocumentListingResponse.FileNodeResponse.class
    )
    @SubclassMapping(
        source = DocumentListing.FolderNode.class,
        target = DocumentListingResponse.FolderNodeResponse.class
    )
    DocumentListingResponse.DocumentNodeResponse toResponse(
        DocumentListing.DocumentNode node
    );

    DocumentListingResponse.FileNodeResponse toFileResponse(
        DocumentListing.FileNode file
    );

    DocumentListingResponse.FolderNodeResponse toFolderResponse(
        DocumentListing.FolderNode folder
    );

    List<DocumentListingResponse.DocumentNodeResponse> toResponses(
        List<DocumentListing.DocumentNode> nodes
    );
}
```

Preserve any existing property mappings on the concrete file/folder methods. Do not
replace or lose mapper annotations that are required by the current DTO fields.

Update the controller to delegate the complete collection conversion to the mapper:

```java
List<DocumentListing.DocumentNode> domainResults =
    documentService.searchDocuments(projectId, listKey, folderId, q);

List<DocumentListingResponse.DocumentNodeResponse> results =
    documentListingMapper.toResponses(domainResults);

return ResponseEntity.ok(results);
```

Remove controller-side `instanceof` dispatch, casts, streams, or loops used only to
choose between file and folder response mapping.

## Compatibility fallback

Do not upgrade MapStruct solely for this refactor. If the installed version does not
support this `@SubclassMapping` configuration, put explicit exhaustive dispatch in a
mapper default method instead:

```java
default DocumentListingResponse.DocumentNodeResponse toResponse(
        DocumentListing.DocumentNode node) {
    if (node == null) {
        return null;
    }

    if (node instanceof DocumentListing.FileNode file) {
        return toFileResponse(file);
    }

    if (node instanceof DocumentListing.FolderNode folder) {
        return toFolderResponse(folder);
    }

    throw new IllegalArgumentException(
        "Unsupported document node type: " + node.getClass().getName()
    );
}
```

Keep `toResponses(...)` as the collection mapping method so MapStruct invokes
`toResponse(...)` for every element. Never use an `else` branch that blindly casts an
unknown subtype to `FolderNode`.

## Constraints

- Change only the mapper and controller code required for this refactor.
- Do not change the endpoint, response JSON, service contract, domain models, DTOs, or
  business behavior.
- Do not move API DTO mapping into the service.
- Do not add manual mapping logic when existing concrete MapStruct mappings already
  handle the fields.
- Avoid unrelated refactoring.

After implementation, report the files changed and whether `@SubclassMapping` or the
compatible default-method fallback was used.
