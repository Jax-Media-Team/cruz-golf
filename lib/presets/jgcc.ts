/**
 * Jacksonville Golf & Country Club — exact scorecard data.
 * Pars derived from yardages (par 3 < 250y, par 5 > 480y from Black).
 */

export const JGCC_NAME = "Jacksonville Golf & Country Club";
export const JGCC_CITY = "Jacksonville";
export const JGCC_STATE = "FL";

// Pars by hole 1..18 (Out 36 + In 36 = 72)
export const JGCC_PARS = [5, 4, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 4, 5, 4, 5, 3, 4];

// Stroke index per hole (1 = hardest)
export const JGCC_MENS_SI =    [13, 7, 17, 3, 15, 5, 11, 1, 9, 16, 2, 12, 8, 18, 6, 14, 10, 4];
export const JGCC_LADIES_SI =  [7, 9, 15, 13, 17, 11, 5, 1, 3, 16, 14, 18, 8, 10, 4, 12, 2, 6];

// Yardages per tee per hole 1..18
export const JGCC_YARDAGE = {
  Black:     [519, 382, 165, 422, 404, 175, 377, 519, 441, 387, 376, 187, 411, 536, 412, 558, 196, 425],
  Gold:      [500, 367, 157, 404, 392, 167, 362, 504, 428, 373, 361, 177, 392, 509, 392, 538, 177, 385],
  Silver:    [486, 341, 147, 377, 321, 155, 340, 485, 407, 356, 340, 156, 372, 487, 370, 523, 158, 381],
  Jade:      [450, 307, 132, 320, 308, 138, 300, 441, 381, 313, 300, 141, 330, 457, 328, 486, 142, 361],
  Cranberry: [423, 276, 118, 283, 287, 124, 270, 417, 338, 278, 276, 125, 293, 427, 293, 447, 114, 318]
};

export type JgccTeeKey = keyof typeof JGCC_YARDAGE;

export const JGCC_TEES: Array<{
  key: JgccTeeKey;
  label: string;
  rating: number;
  slope: number;
  gender: "M" | "F" | "any";
  ladies: boolean;
}> = [
  { key: "Black",     label: "Black (Tournament)",   rating: 73.2, slope: 138, gender: "M",   ladies: false },
  { key: "Gold",      label: "Gold (Championship)",  rating: 71.8, slope: 133, gender: "M",   ladies: false },
  { key: "Silver",    label: "Silver (Center)",      rating: 70.6, slope: 120, gender: "M",   ladies: false },
  { key: "Jade",      label: "Jade (Allowance)",     rating: 67.8, slope: 117, gender: "M",   ladies: false },
  { key: "Cranberry", label: "Cranberry (Forward)",  rating: 70.4, slope: 125, gender: "F",   ladies: true  }
];
