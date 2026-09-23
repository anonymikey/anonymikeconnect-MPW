const packages = [
  // Existing production entries are preserved below. New catalog entries use unique IDs.
  {
    id: 'hours_1',
    name: '1 Hour Unlimited',
    price: 5,
    amount: 5,
    duration: '1 hour',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'QUICK ACCESS'
  },
  {
    id: 'hours_3',
    name: '3 Hours Unlimited',
    price: 8,
    amount: 8,
    duration: '3 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'QUICK ACCESS'
  },
  {
    id: 'hours_6',
    name: '6 Hours Unlimited',
    price: 15,
    amount: 15,
    duration: '6 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'QUICK ACCESS'
  },
  {
    id: 'hours_24',
    name: '24 Hours Unlimited',
    price: 30,
    amount: 30,
    duration: '24 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'MOST POPULAR'
  },
  {
    id: 'days_2',
    name: '2 Days Unlimited',
    price: 50,
    amount: 50,
    duration: '2 days',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'POPULAR'
  },
  {
    id: 'days_30_450',
    name: '30 Days Unlimited',
    price: 450,
    amount: 450,
    duration: '30 days',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'MONTHLY UNLIMITED'
  },
  {
    id: 'data_100gb_30d',
    name: '100 GB Data Plan',
    price: 400,
    amount: 400,
    duration: '30 days',
    bandwidth: 'limited',
    data: '100 GB',
    label: 'DATA PLAN'
  },
  {
    id: 'monthly_unlimited',
    name: 'Monthly Unlimited',
    price: 600,
    amount: 600,
    duration: '30 days',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'MOST POPULAR'
  },
  {
    id: 'monthly_100gb',
    name: 'Monthly 100 GB',
    price: 400,
    amount: 400,
    duration: '30 days',
    bandwidth: '100 GB',
    data: '100 GB',
    label: 'DATA PLAN'
  },
  {
    id: 'weekly_unlimited',
    name: '7 Days Unlimited',
    price: 150,
    amount: 150,
    duration: '7 days',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'WEEKLY'
  },
  {
    id: 'daily_pro',
    name: 'Daily Unlimited Pro',
    price: 50,
    amount: 50,
    duration: '24 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'PRO'
  },
  {
    id: 'daily_standard',
    name: 'Daily Unlimited Standard',
    price: 30,
    amount: 30,
    duration: '24 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'STANDARD'
  },
  {
    id: 'hours_12',
    name: '12 Hours Unlimited',
    price: 20,
    amount: 20,
    duration: '12 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: '12H'
  },
  {
    id: 'hours_5',
    name: '5 Hours Unlimited',
    price: 10,
    amount: 10,
    duration: '5 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: '5H'
  }
];

module.exports = {
  packages,
  findPackageById(packageId) {
    return packages.find((item) => item.id === packageId) || null;
  }
};
