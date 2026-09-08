# Select matte regions without erasing artwork

Use this procedure when checkerboard removal damages pale artwork or removes detached foreground details. Select candidates and seeds from the current image; never reuse another card’s coordinates or thresholds. This helper does not solve geometric alignment, text extraction or contour registration.

## Matte selection without erasing artwork

Color resemblance is only a candidate signal. Gray cuffs, white hair, highlights and pale lettering may match the matte. A large region is not proof of background, and being connected to the canvas edge is insufficient when the subject touches that edge. Inspect the actual checker pattern and silhouette first.

Build an aligned grayscale candidate mask with 255 only where matte connectivity is eligible. Add protected subject regions and break candidate bridges where matte leaks into artwork. Remove only components reached from explicitly inspected matte seeds. Enclosed gaps require their own inspected seeds; never remove every enclosed neutral region. Do not keep only the largest foreground component: detached accessories, particles and separate subjects may be intentional.

The optional Pillow-only helper performs this deterministic connectivity operation. It does not detect a checkerboard, choose seeds, or produce soft edges:

```sh
python3 <skill-dir>/scripts/matte_regions.py --candidate /path/candidate.png --seed X,Y --seed GAP_X,GAP_Y --existing-alpha /path/current-alpha.png --protect /path/protected-artwork.png --output /path/new-selection.png
```

Seed coordinates above are placeholders chosen by inspecting the current image. Omit existing-alpha only for fully opaque input; omit protect only when candidates cannot leak into artwork. Candidate/protection/alpha masks must share the actual full canvas. Only candidate value 255 is traversable. The helper preserves all alpha outside selected matte components, including partially transparent edges. Inspect and refine edge coverage locally afterward; do not blur the whole mask. Composite over both black and white, check interior holes and colored fringes, then use `native.py apply-alpha`.

