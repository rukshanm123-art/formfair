# Corpus attestations

The official, hash-only corpus manifest will be committed here before FormFair is run on
the captured pages. Captured HTML and the detailed working files remain under the ignored
`evaluation/data/` directory.

The commit carrying the final manifest is tagged `corpus-v1.0.0`. The official
descriptive command verifies that its `--manifest` is tracked, unchanged and present at
that exact tag. This tag establishes sequencing; a digest stored only beside the files it
describes would bind their contents but could not prove that the manifest preceded the
analysis.
