/**
 * Every word a farmer sees on USSD or SMS, in English, Ichibemba and Chinyanja.
 * Keep lines short: a USSD screen holds about 182 characters (tests check every screen in every language).
 * The Bemba and Nyanja wording should be reviewed by native speakers before real use.
 */
export type Lang = 'en' | 'bem' | 'nya'
export const LANGS: Lang[] = ['en', 'bem', 'nya']
export const LANG_NAMES: Record<Lang, string> = { en: 'English', bem: 'Ichibemba', nya: 'Chinyanja' }

export interface Words {
  invalid: string
  back: string
  more: string
  yes: string
  no: string
  menuOffers: string
  menuPledges: string
  menuPayments: string
  menuRecord: string
  menuLanguage: string
  chooseLanguage: string
  welcomeNew: string
  register: string
  enterName: string
  nameInvalid: string
  chooseDepot: string
  confirmRegister: (name: string, depot: string) => string
  registered: (first: string, code: string) => string
  noOffers: (depot: string) => string
  offersAt: (depot: string) => string
  crop: Record<string, string>
  gradeOrBetter: (grade: string) => string
  perBag: (bagPrice: string) => string
  buyer: (name: string) => string
  deliverTo: (depot: string, date: string) => string
  noFees: string
  howManyBags: (max: number) => string
  bagsInvalid: (max: number) => string
  confirmPledge: (bags: number, kg: number, crop: string, bagPrice: string, total: string, buyer: string) => string
  pledged: (ref: string, bags: number, depot: string, date: string) => string
  offerClosed: string
  pledgesTitle: string
  noPledges: string
  pledgeStatus: Record<'PLEDGED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED', string>
  paymentsTitle: string
  noPayments: string
  paymentStatus: Record<'PAID' | 'SENDING' | 'RETRYING', string>
  recordTitle: (score: number, band: string) => string
  band: Record<'BUILDING' | 'FAIR' | 'GOOD' | 'STRONG', string>
  recordSales: (count: number, amount: string) => string
  recordReliability: (pct: number) => string
  shareWithLender: string
  shared: (code: string, host: string) => string
  languageSaved: string
  cancelled: (code: string) => string
  error: string
  bags: string
  sms: {
    welcome: (first: string, code: string) => string
    newOffer: (crop: string, price: string, depot: string, code: string) => string
    pledged: (ref: string, bags: number, crop: string, depot: string, date: string) => string
    received: (grn: string, bags: number, kg: string, grade: string, depot: string, amount: string) => string
    rejected: (grn: string, depot: string, reason: string) => string
    paid: (amount: string, ref: string, invoice: string) => string
    shared: (code: string, host: string) => string
  }
}

const en: Words = {
  invalid: 'Invalid choice.',
  back: '0. Back',
  more: '9. More',
  yes: '1. Yes',
  no: '2. No',
  menuOffers: 'Buyer offers',
  menuPledges: 'My pledges',
  menuPayments: 'My payments',
  menuRecord: 'My trade record',
  menuLanguage: 'Language',
  chooseLanguage: 'Choose language',
  welcomeNew: 'Sell your harvest to verified buyers. Paid to Zamtel Money. No fees.',
  register: 'Register',
  enterName: 'Enter your full name:',
  nameInvalid: 'Please enter your name using letters.',
  chooseDepot: 'Your nearest depot:',
  confirmRegister: (name, depot) => `Register ${name} at ${depot} Depot?`,
  registered: (first, code) => `Welcome, ${first}! Dial ${code} any time to see buyer offers.`,
  noOffers: (depot) => `No open offers at ${depot} Depot right now. We will SMS you when a buyer posts one.`,
  offersAt: (depot) => `Offers at ${depot} Depot`,
  crop: { MAIZE: 'Maize', SOYA: 'Soya', GROUNDNUTS: 'Groundnuts', SUNFLOWER: 'Sunflower' },
  gradeOrBetter: (g) => `grade ${g} or better`,
  perBag: (p) => `${p} per 50kg bag`,
  buyer: (n) => `Buyer: ${n}`,
  deliverTo: (d, date) => `To ${d} Depot by ${date}`,
  noFees: 'No fees. Paid on delivery.',
  howManyBags: (max) => `How many bags? (1-${max})`,
  bagsInvalid: (max) => `Enter a number from 1 to ${max}.`,
  confirmPledge: (bags, kg, crop, bagPrice, total, buyer) => `Pledge ${bags} bags (${kg}kg) of ${crop} at ${bagPrice}/bag = ${total} to ${buyer}?`,
  pledged: (ref, bags, depot, date) => `Pledged! Ref ${ref}. Take ${bags} bags to ${depot} Depot by ${date}. We will SMS you when they are weighed.`,
  offerClosed: 'Sorry, this offer has just closed or is full.',
  pledgesTitle: 'My pledges',
  noPledges: 'You have no pledges yet.',
  pledgeStatus: { PLEDGED: 'Pledged', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', EXPIRED: 'Expired' },
  paymentsTitle: 'My payments',
  noPayments: 'No payments yet.',
  paymentStatus: { PAID: 'Paid', SENDING: 'Sending', RETRYING: 'Retrying' },
  recordTitle: (s, b) => `Trade record: ${s}/100 (${b})`,
  band: { BUILDING: 'Building', FAIR: 'Fair', GOOD: 'Good', STRONG: 'Strong' },
  recordSales: (n, a) => `${n} sales, ${a} in 12 months`,
  recordReliability: (p) => `Delivered ${p}% of pledges`,
  shareWithLender: '1. Share with a lender',
  shared: (code, host) => `Share code ${code}. A lender can check your record at ${host}/credit for 7 days. Sent by SMS too.`,
  languageSaved: 'Language saved.',
  cancelled: (code) => `Cancelled. Dial ${code} to start again.`,
  error: 'Sorry, something went wrong. Please try again.',
  bags: 'bags',
  sms: {
    welcome: (first, code) => `Welcome to Agri-OS, ${first}. Dial ${code} to see buyer offers. You never pay fees.`,
    newOffer: (crop, price, depot, code) => `Agri-OS: New offer for ${crop} at ${price}/kg, ${depot} Depot. Dial ${code} to pledge.`,
    pledged: (ref, bags, crop, depot, date) => `Agri-OS: Pledge ${ref} confirmed: ${bags} bags of ${crop} to ${depot} Depot by ${date}.`,
    received: (grn, bags, kg, grade, depot, amount) => `Agri-OS: ${depot} Depot received ${bags} bags (${kg}, grade ${grade}). Receipt ${grn}. You will be paid ${amount} when the truck is weighed.`,
    rejected: (grn, depot, reason) => `Agri-OS: ${depot} Depot could not accept your delivery (${grn}): ${reason}.`,
    paid: (amount, ref, invoice) => `Agri-OS: ${amount} paid to your Zamtel Money. Ref ${ref}. Invoice ${invoice} recorded with ZRA.`,
    shared: (code, host) => `Agri-OS: Your share code is ${code}. A lender can check your trade record at ${host}/credit for 7 days.`,
  },
}

const bem: Words = {
  invalid: 'Mwalufyanya.',
  back: '0. Bwelela',
  more: '9. Nafimbi',
  yes: '1. Ee',
  no: '2. Awe',
  menuOffers: 'Imitengo ya bashita',
  menuPledges: 'Amalayo yandi',
  menuPayments: 'Indalama nalipilwa',
  menuRecord: 'Ifyalembwa fyandi',
  menuLanguage: 'Ululimi',
  chooseLanguage: 'Saleni ululimi',
  welcomeNew: 'Shitisheni ifyo mwalima ku bashita abeshibikwa. Mukalipilwa pa Zamtel Money. Tapali ifyakulipila.',
  register: 'Ilembesheni',
  enterName: 'Lembeni ishina lyenu lyonse:',
  nameInvalid: 'Lembeni ishina lyenu ne filembo.',
  chooseDepot: 'Idepo iyapalamina:',
  confirmRegister: (name, depot) => `Ukulembesha ${name} pa ${depot} Depot?`,
  registered: (first, code) => `Mwaiseni, ${first}! Iteni ${code} ukumona imitengo ya bashita.`,
  noOffers: (depot) => `Tapali abashita pa ${depot} Depot nomba. Tukamutumina SMS.`,
  offersAt: (depot) => `Imitengo pa ${depot} Depot`,
  crop: { MAIZE: 'Amataba', SOYA: 'Soya', GROUNDNUTS: 'Imbalala', SUNFLOWER: 'Sunflawa' },
  gradeOrBetter: (g) => `grade ${g} nangu ukucila`,
  perBag: (p) => `${p} pa mufuko`,
  buyer: (n) => `Uushita: ${n}`,
  deliverTo: (d, date) => `Ku ${d} Depot pa ${date}`,
  noFees: 'Tapali ifyakulipila.',
  howManyBags: (max) => `Imifuko inga? (1-${max})`,
  bagsInvalid: (max) => `Lembeni inambala ukufuma 1 ukufika ${max}.`,
  confirmPledge: (bags, kg, crop, bagPrice, total, buyer) => `Mulelaya imifuko ${bags} (${kg}kg) ya ${crop} pa ${bagPrice} = ${total} kuli ${buyer}?`,
  pledged: (ref, bags, depot, date) => `Cawama! Ref ${ref}. Twaleni imifuko ${bags} ku ${depot} Depot pa ${date}. Tukamutumina SMS.`,
  offerClosed: 'Mutulekelele, uyu mutengo nawisalwa.',
  pledgesTitle: 'Amalayo yandi',
  noPledges: 'Tamulalaya nangu cimo.',
  pledgeStatus: { PLEDGED: 'Mwalaya', DELIVERED: 'Fyafika', CANCELLED: 'Fyalekwa', EXPIRED: 'Inshita yapwa' },
  paymentsTitle: 'Indalama nalipilwa',
  noPayments: 'Tamulalipilwa.',
  paymentStatus: { PAID: 'Mwalipilwa', SENDING: 'Tulelipila', RETRYING: 'Tuleesha nakabili' },
  recordTitle: (s, b) => `Ifyalembwa: ${s}/100 (${b})`,
  band: { BUILDING: 'Ukukula', FAIR: 'Fisuma panono', GOOD: 'Fisuma', STRONG: 'Fisuma nganshi' },
  recordSales: (n, a) => `Ukushitisha ${n}, ${a} mu myeshi 12`,
  recordReliability: (p) => `Mwatwele ${p}% ya malayo`,
  shareWithLender: '1. Langisheni uwakongolesha',
  shared: (code, host) => `Inambala: ${code}. Uwakongolesha kuti amona ifyalembwa fyenu pa ${host}/credit pa nshiku 7.`,
  languageSaved: 'Ululimi lwasungwa.',
  cancelled: (code) => `Mwaleka. Iteni ${code} ukutampa nakabili.`,
  error: 'Mutulekelele, kuli ubwafya. Esheni nakabili.',
  bags: 'imifuko',
  sms: {
    welcome: (first, code) => `Mwaiseni ku Agri-OS, ${first}. Iteni ${code} ukumona imitengo ya bashita. Tapali ifyakulipila.`,
    newOffer: (crop, price, depot, code) => `Agri-OS: Umutengo mupya wa ${crop}: ${price}/kg pa ${depot} Depot. Iteni ${code}.`,
    pledged: (ref, bags, crop, depot, date) => `Agri-OS: Ilayo ${ref}: imifuko ${bags} ya ${crop} ku ${depot} Depot pa ${date}.`,
    received: (grn, bags, kg, grade, depot, amount) => `Agri-OS: ${depot} Depot yapokelela imifuko ${bags} (${kg}, grade ${grade}). Receipt ${grn}. Mukalipilwa ${amount}.`,
    rejected: (grn, depot, reason) => `Agri-OS: ${depot} Depot tayapokelele (${grn}): ${reason}.`,
    paid: (amount, ref, invoice) => `Agri-OS: ${amount} yafika pa Zamtel Money yenu. Ref ${ref}. Invoice ${invoice} yalembwa ku ZRA.`,
    shared: (code, host) => `Agri-OS: Inambala yenu ni ${code}. Uwakongolesha kuti amona ifyalembwa fyenu pa ${host}/credit.`,
  },
}

const nya: Words = {
  invalid: 'Mwalakwitsa.',
  back: '0. Bwererani',
  more: '9. Zina',
  yes: '1. Inde',
  no: '2. Ayi',
  menuOffers: 'Mitengo ya ogula',
  menuPledges: 'Malonjezo anga',
  menuPayments: 'Malipiro anga',
  menuRecord: 'Mbiri ya malonda',
  menuLanguage: 'Chilankhulo',
  chooseLanguage: 'Sankhani chilankhulo',
  welcomeNew: 'Gulitsani zokolola kwa ogula odalirika. Mudzalipidwa pa Zamtel Money. Palibe zolipira.',
  register: 'Lembetsani',
  enterName: 'Lembani dzina lanu lonse:',
  nameInvalid: 'Lembani dzina lanu ndi zilembo.',
  chooseDepot: 'Depo yapafupi:',
  confirmRegister: (name, depot) => `Kulembetsa ${name} ku ${depot} Depot?`,
  registered: (first, code) => `Takulandirani, ${first}! Imbani ${code} kuti muone mitengo ya ogula.`,
  noOffers: (depot) => `Palibe ogula ku ${depot} Depot pano. Tidzakutumizirani SMS.`,
  offersAt: (depot) => `Mitengo ku ${depot} Depot`,
  crop: { MAIZE: 'Chimanga', SOYA: 'Soya', GROUNDNUTS: 'Mtedza', SUNFLOWER: 'Mpendadzuwa' },
  gradeOrBetter: (g) => `giredi ${g} kapena kuposa`,
  perBag: (p) => `${p} pa thumba`,
  buyer: (n) => `Wogula: ${n}`,
  deliverTo: (d, date) => `Ku ${d} Depot pofika ${date}`,
  noFees: 'Palibe zolipira.',
  howManyBags: (max) => `Matumba angati? (1-${max})`,
  bagsInvalid: (max) => `Lembani nambala kuyambira 1 mpaka ${max}.`,
  confirmPledge: (bags, kg, crop, bagPrice, total, buyer) => `Lonjezani matumba ${bags} (${kg}kg) a ${crop} pa ${bagPrice} = ${total} kwa ${buyer}?`,
  pledged: (ref, bags, depot, date) => `Zatheka! Ref ${ref}. Perekani matumba ${bags} ku ${depot} Depot pofika ${date}. Tidzakutumizirani SMS.`,
  offerClosed: 'Pepani, mtengo uwu watsekedwa kapena wadzaza.',
  pledgesTitle: 'Malonjezo anga',
  noPledges: 'Mulibe malonjezo panopa.',
  pledgeStatus: { PLEDGED: 'Mwalonjeza', DELIVERED: 'Zaperekedwa', CANCELLED: 'Zathetsedwa', EXPIRED: 'Nthawi yatha' },
  paymentsTitle: 'Malipiro anga',
  noPayments: 'Palibe malipiro panopa.',
  paymentStatus: { PAID: 'Zalipidwa', SENDING: 'Zikutumizidwa', RETRYING: 'Tikuyesanso' },
  recordTitle: (s, b) => `Mbiri: ${s}/100 (${b})`,
  band: { BUILDING: 'Ikukula', FAIR: "Bwino pang'ono", GOOD: 'Bwino', STRONG: 'Bwino kwambiri' },
  recordSales: (n, a) => `Malonda ${n}, ${a} m'miyezi 12`,
  recordReliability: (p) => `Munapereka ${p}% ya malonjezo`,
  shareWithLender: '1. Gawani ndi wobwereketsa',
  shared: (code, host) => `Nambala: ${code}. Wobwereketsa angaone mbiri yanu pa ${host}/credit kwa masiku 7.`,
  languageSaved: 'Chilankhulo chasungidwa.',
  cancelled: (code) => `Mwaletsa. Imbani ${code} kuti muyambenso.`,
  error: 'Pepani, pali vuto. Yesaninso.',
  bags: 'matumba',
  sms: {
    welcome: (first, code) => `Takulandirani ku Agri-OS, ${first}. Imbani ${code} kuti muone mitengo ya ogula. Palibe zolipira.`,
    newOffer: (crop, price, depot, code) => `Agri-OS: Mtengo watsopano wa ${crop}: ${price}/kg ku ${depot} Depot. Imbani ${code}.`,
    pledged: (ref, bags, crop, depot, date) => `Agri-OS: Lonjezo ${ref}: matumba ${bags} a ${crop} ku ${depot} Depot pofika ${date}.`,
    received: (grn, bags, kg, grade, depot, amount) => `Agri-OS: ${depot} Depot yalandira matumba ${bags} (${kg}, giredi ${grade}). Risiti ${grn}. Mudzalipidwa ${amount}.`,
    rejected: (grn, depot, reason) => `Agri-OS: ${depot} Depot sinalandire (${grn}): ${reason}.`,
    paid: (amount, ref, invoice) => `Agri-OS: ${amount} yatumizidwa ku Zamtel Money yanu. Ref ${ref}. Invoice ${invoice} yalembedwa ku ZRA.`,
    shared: (code, host) => `Agri-OS: Nambala yanu ndi ${code}. Wobwereketsa angaone mbiri yanu pa ${host}/credit.`,
  },
}

export const WORDS: Record<Lang, Words> = { en, bem, nya }

export function words(lang: Lang): Words {
  return WORDS[lang] ?? en
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "30 Nov": short enough for USSD and understood everywhere. Shown in Zambian time (UTC+2). */
export function shortDate(date: Date): string {
  const cat = new Date(date.getTime() + 2 * 60 * 60 * 1000)
  return `${cat.getUTCDate()} ${MONTHS[cat.getUTCMonth()]}`
}

export function isLang(value: string): value is Lang {
  return (LANGS as string[]).includes(value)
}
