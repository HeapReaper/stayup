// Package ids generates primary keys for rows the Go workers create directly.
// Every model in the Prisma schema uses `@id @default(cuid())` — that default
// only fires when Prisma itself does the insert, so anything a worker inserts
// needs to generate its own id. Using the same cuid format (rather than e.g.
// a UUID) just keeps ids visually consistent with the rows the Next.js app
// creates; nothing actually parses or relies on the format.
package ids

import (
	"crypto/rand"

	"github.com/lucsky/cuid"
)

// New returns a new cuid, e.g. "cm2j3k9p20000xyzabc12defg".
func New() string {
	id, err := cuid.NewCrypto(rand.Reader)
	if err != nil {
		// cuid.New() falls back to math/rand instead of crypto/rand — still
		// unique, just not cryptographically random. Only used as a last
		// resort if the crypto source itself is failing.
		return cuid.New()
	}
	return id
}
